'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data.json');
const PUBLIC = path.join(__dirname, 'public');

// ---------- Penyimpanan sederhana (file JSON) ----------
let db = { users: {}, messages: [], sessions: {} };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; } catch {}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DB_FILE + '.tmp', JSON.stringify(db), (e) => {
      if (!e) fs.rename(DB_FILE + '.tmp', DB_FILE, () => {});
    });
  }, 200);
}

// ---------- Auth ----------
const USER_RE = /^[a-z0-9_.]{3,20}$/;
const hash = (pw, salt) => crypto.scryptSync(pw, salt, 32).toString('hex');

function createSession(username) {
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = username;
  save();
  return token;
}

function register(username, password) {
  username = String(username || '').toLowerCase().trim();
  if (!USER_RE.test(username)) throw new Error('Username 3-20 karakter: huruf, angka, _ atau .');
  if (String(password || '').length < 6) throw new Error('Password minimal 6 karakter');
  if (db.users[username]) throw new Error('Username sudah dipakai');
  const salt = crypto.randomBytes(16).toString('hex');
  db.users[username] = { salt, hash: hash(password, salt), created: Date.now() };
  return { token: createSession(username), username };
}

function login(username, password) {
  username = String(username || '').toLowerCase().trim();
  const u = db.users[username];
  const ok = u && crypto.timingSafeEqual(
    Buffer.from(u.hash, 'hex'), Buffer.from(hash(String(password || ''), u.salt), 'hex'));
  if (!ok) throw new Error('Username atau password salah');
  return { token: createSession(username), username };
}

// ---------- Chat ----------
const convId = (a, b) => [a, b].sort().join('|');
const online = new Map(); // username -> Set<ws>

function chatList(me) {
  const last = new Map();
  for (const m of db.messages) {
    if (m.from !== me && m.to !== me) continue;
    const peer = m.from === me ? m.to : m.from;
    last.set(peer, m);
  }
  return [...last.entries()]
    .map(([peer, m]) => ({ peer, last: m, online: online.has(peer) }))
    .sort((a, b) => b.last.ts - a.last.ts);
}

function sendTo(user, payload) {
  const data = JSON.stringify(payload);
  for (const ws of online.get(user) || []) if (ws.readyState === 1) ws.send(data);
}

function addMessage(from, to, text) {
  text = String(text || '').trim().slice(0, 4000);
  if (!text) throw new Error('Pesan kosong');
  if (!db.users[to]) throw new Error('Pengguna tidak ditemukan');
  if (to === from) throw new Error('Tidak bisa mengirim ke diri sendiri');
  const m = { id: crypto.randomUUID(), conv: convId(from, to), from, to, text, ts: Date.now() };
  db.messages.push(m);
  save();
  sendTo(from, { type: 'message', message: m });
  sendTo(to, { type: 'message', message: m });
  return m;
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > 1e5) { reject(new Error('Terlalu besar')); req.destroy(); } });
    req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { reject(new Error('JSON tidak valid')); } });
  });
}

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};

const authUser = (req, url) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : url.searchParams.get('token');
  return db.sessions[token] || null;
};

// pembatas laju sederhana untuk login/daftar
const attempts = new Map();
function limited(ip) {
  const now = Date.now();
  const a = (attempts.get(ip) || []).filter((t) => now - t < 60000);
  a.push(now);
  attempts.set(ip, a);
  return a.length > 10;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) {
      if (req.method === 'POST' && (url.pathname === '/api/register' || url.pathname === '/api/login')) {
        if (limited(req.socket.remoteAddress)) return json(res, 429, { error: 'Terlalu banyak percobaan, coba lagi nanti' });
        const { username, password } = await readBody(req);
        return json(res, 200, url.pathname === '/api/register' ? register(username, password) : login(username, password));
      }
      const me = authUser(req, url);
      if (!me) return json(res, 401, { error: 'Belum login' });
      if (url.pathname === '/api/chats') return json(res, 200, { me, chats: chatList(me) });
      let m;
      if ((m = url.pathname.match(/^\/api\/messages\/([a-z0-9_.]+)$/))) {
        const id = convId(me, m[1]);
        return json(res, 200, { messages: db.messages.filter((x) => x.conv === id).slice(-500) });
      }
      if ((m = url.pathname.match(/^\/api\/users\/([a-z0-9_.]+)$/))) {
        return json(res, 200, { exists: !!db.users[m[1]], online: online.has(m[1]) });
      }
      if (url.pathname === '/api/logout' && req.method === 'POST') {
        const h = req.headers.authorization || '';
        delete db.sessions[h.slice(7)]; save();
        return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'Tidak ditemukan' });
    }
    // file statis
    let file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (e, data) => {
      if (e) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  } catch (e) {
    json(res, 400, { error: e.message });
  }
});

// ---------- WebSocket ----------
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws, req) => {
  const me = authUser(req, new URL(req.url, 'http://x'));
  if (!me) return ws.close(4001, 'unauthorized');
  if (!online.has(me)) { online.set(me, new Set()); broadcastPresence(me, true); }
  online.get(me).add(ws);
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    try {
      const d = JSON.parse(raw);
      if (d.type === 'send') addMessage(me, String(d.to || '').toLowerCase(), d.text);
      else if (d.type === 'typing') sendTo(String(d.to || ''), { type: 'typing', from: me });
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', error: e.message }));
    }
  });
  ws.on('close', () => {
    const set = online.get(me);
    set.delete(ws);
    if (!set.size) { online.delete(me); broadcastPresence(me, false); }
  });
});

function broadcastPresence(user, isOn) {
  for (const [name, set] of online) {
    if (name === user) continue;
    for (const ws of set) ws.send(JSON.stringify({ type: 'presence', user, online: isOn }));
  }
}

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 30000).unref();

if (require.main === module) {
  server.listen(PORT, () => console.log(`Chat berjalan di http://localhost:${PORT}`));
}
module.exports = { server };
