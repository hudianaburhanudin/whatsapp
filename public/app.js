'use strict';
const $ = (id) => document.getElementById(id);
let token = localStorage.getItem('token');
let me = localStorage.getItem('me');
let current = null;          // username lawan bicara
let chats = new Map();       // peer -> {peer,last,online,unread}
let ws, typingTimer, lastTypingSent = 0;
let registerMode = false;

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'Content-Type': 'application/json',
    ...(token ? { Authorization: 'Bearer ' + token } : {}) } });
  const d = await r.json();
  if (!r.ok) { if (r.status === 401 && token) logout(); throw new Error(d.error || 'Gagal'); }
  return d;
}

// ---- Auth ----
$('toggle').onclick = (e) => {
  e.preventDefault();
  registerMode = !registerMode;
  $('authBtn').textContent = registerMode ? 'Daftar' : 'Masuk';
  $('toggle').textContent = registerMode ? 'Sudah punya akun? Masuk' : 'Belum punya akun? Daftar';
  $('authErr').textContent = '';
};
$('authForm').onsubmit = async (e) => {
  e.preventDefault();
  try {
    const d = await api(registerMode ? '/api/register' : '/api/login', { method: 'POST',
      body: JSON.stringify({ username: $('u').value, password: $('p').value }) });
    token = d.token; me = d.username;
    localStorage.setItem('token', token); localStorage.setItem('me', me);
    start();
  } catch (err) { $('authErr').textContent = err.message; }
};
function logout() {
  if (token) fetch('/api/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
  localStorage.clear(); token = me = null; if (ws) ws.close(); location.reload();
}
$('logout').onclick = logout;

// ---- Start ----
let start = async function () {
  $('auth').hidden = true; $('app').hidden = false; $('meName').textContent = '@' + me;
  const d = await api('/api/chats');
  chats = new Map(d.chats.map((c) => [c.peer, { ...c, unread: 0 }]));
  renderChats(); connect();
};
function connect() {
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws?token=' + token);
  ws.onmessage = (ev) => {
    const d = JSON.parse(ev.data);
    if (d.type === 'message') onMessage(d.message);
    else if (d.type === 'presence') { const c = chats.get(d.user); if (c) c.online = d.online; renderChats(); if (d.user === current) setStatus(d.online ? 'online' : ''); }
    else if (d.type === 'typing' && d.from === current) { setStatus('mengetik…'); clearTimeout(typingTimer); typingTimer = setTimeout(refreshStatus, 2000); }
    else if (d.type === 'error') $('newErr').textContent = d.error;
  };
  ws.onclose = (e) => { if (e.code !== 4001 && token) setTimeout(connect, 2000); };
}

// ---- Daftar chat ----
function renderChats() {
  const ul = $('chats'); ul.innerHTML = '';
  [...chats.values()].sort((a, b) => b.last.ts - a.last.ts).forEach((c) => {
    const li = document.createElement('li');
    if (c.peer === current) li.className = 'active';
    const top = document.createElement('div'); top.className = 'top';
    const name = document.createElement('span'); name.className = 'name';
    name.textContent = '@' + c.peer + (c.online ? ' ' : '');
    if (c.online) { const dot = document.createElement('span'); dot.className = 'dot'; dot.textContent = '●'; name.append(dot); }
    const t = document.createElement('small'); t.textContent = fmt(c.last.ts);
    top.append(name, t);
    const last = document.createElement('div'); last.className = 'last';
    last.textContent = (c.last.from === me ? 'Anda: ' : '') + c.last.text;
    li.append(top, last);
    if (c.unread) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = c.unread; li.append(b); }
    li.onclick = () => openChat(c.peer);
    ul.append(li);
  });
}
const fmt = (ts) => new Date(ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

$('newChat').onsubmit = async (e) => {
  e.preventDefault(); $('newErr').textContent = '';
  const p = $('peer').value.toLowerCase().trim().replace(/^@/, '');
  if (!p) return;
  if (p === me) { $('newErr').textContent = 'Itu username Anda sendiri'; return; }
  try {
    const d = await api('/api/users/' + encodeURIComponent(p));
    if (!d.exists) { $('newErr').textContent = 'Username tidak ditemukan'; return; }
    $('peer').value = ''; openChat(p);
  } catch (err) { $('newErr').textContent = err.message; }
};

// ---- Ruang chat ----
async function openChat(peer) {
  current = peer;
  const c = chats.get(peer); if (c) c.unread = 0;
  $('empty').hidden = true; $('room').hidden = false; $('app').classList.add('chatting');
  $('peerName').textContent = '@' + peer; $('msgs').innerHTML = '';
  const d = await api('/api/messages/' + encodeURIComponent(peer));
  if (current !== peer) return;
  d.messages.forEach(addBubble); scrollDown(); renderChats(); refreshStatus(); $('text').focus();
}
async function refreshStatus() {
  if (!current) return;
  try { const d = await api('/api/users/' + encodeURIComponent(current)); setStatus(d.online ? 'online' : ''); } catch {}
}
const setStatus = (s) => { $('peerStatus').textContent = s; };
$('back').onclick = () => { current = null; $('app').classList.remove('chatting'); $('room').hidden = true; $('empty').hidden = false; renderChats(); };

function addBubble(m) {
  const d = document.createElement('div'); d.className = 'msg' + (m.from === me ? ' me' : '');
  d.textContent = m.text;
  const t = document.createElement('time'); t.textContent = fmt(m.ts); d.append(t);
  $('msgs').append(d);
}
const scrollDown = () => { const el = $('msgs'); el.scrollTop = el.scrollHeight; };

function onMessage(m) {
  const peer = m.from === me ? m.to : m.from;
  const c = chats.get(peer) || { peer, online: false, unread: 0 };
  c.last = m;
  if (peer === current) { addBubble(m); scrollDown(); }
  else if (m.from !== me) { c.unread++; if (document.hidden) document.title = '(•) Chat Tanpa Nomor'; }
  chats.set(peer, c); renderChats();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) document.title = 'Chat Tanpa Nomor'; });

$('send').onsubmit = (e) => {
  e.preventDefault();
  const text = $('text').value.trim();
  if (!text || !current || ws.readyState !== 1) return;
  ws.send(JSON.stringify({ type: 'send', to: current, text }));
  $('text').value = '';
};
$('text').oninput = () => {
  if (current && ws.readyState === 1 && Date.now() - lastTypingSent > 1500) {
    lastTypingSent = Date.now(); ws.send(JSON.stringify({ type: 'typing', to: current }));
  }
};

// ---- Kirim ke WhatsApp lewat wa.me (memakai WhatsApp pengguna sendiri) ----
function normalizePhone(raw) {
  let n = String(raw).replace(/[^\d+]/g, '');
  if (n.startsWith('+')) n = n.slice(1);
  else if (n.startsWith('00')) n = n.slice(2);
  else if (n.startsWith('0')) n = '62' + n.slice(1);
  return /^\d{8,15}$/.test(n) ? n : null;
}
$('waForm').onsubmit = (e) => {
  e.preventDefault();
  const n = normalizePhone($('waNum').value);
  if (!n) { $('toolMsg').textContent = 'Nomor tidak valid'; return; }
  $('toolMsg').textContent = '';
  window.open('https://wa.me/' + n + '?text=' + encodeURIComponent($('waText').value), '_blank', 'noopener');
};
$('invite').onclick = async () => {
  const link = location.origin + '/?chat=' + encodeURIComponent(me);
  try { await navigator.clipboard.writeText(link); $('toolMsg').textContent = 'Tautan disalin: ' + link; }
  catch { $('toolMsg').textContent = link; }
};

// Tautan undangan: /?chat=username membuka chat dengan pengguna itu setelah login
const invitedBy = new URLSearchParams(location.search).get('chat');
if (invitedBy) history.replaceState(null, '', '/');
const startOrig = start;
start = async function () { await startOrig(); if (invitedBy && invitedBy !== me) openChat(invitedBy.toLowerCase()); };

if (token && me) start().catch(() => {});
