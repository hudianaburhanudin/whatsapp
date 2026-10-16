'use strict';
// Tes end-to-end: daftar 2 user, kirim pesan lewat WebSocket, cek riwayat.
process.env.DB_FILE = require('os').tmpdir() + '/chat-test-' + process.pid + '.json';
const assert = require('assert');
const WebSocket = require('ws');
const { server } = require('./server');

const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
const get = (path, token) => fetch(base + path, { headers: { Authorization: 'Bearer ' + token } }).then((r) => r.json());
let base;

server.listen(0, async () => {
  base = 'http://localhost:' + server.address().port;
  try {
    const a = await post('/api/register', { username: 'Alice', password: 'secret1' });
    const b = await post('/api/register', { username: 'bob', password: 'secret2' });
    assert.equal(a.username, 'alice');
    assert.equal((await post('/api/register', { username: 'bob', password: 'xxxxxx' })).status, 400);
    assert.equal((await post('/api/login', { username: 'bob', password: 'salah!!' })).status, 400);

    const wsB = new WebSocket(`ws://localhost:${server.address().port}/ws?token=${b.token}`);
    const wsA = new WebSocket(`ws://localhost:${server.address().port}/ws?token=${a.token}`);
    await Promise.all([wsA, wsB].map((w) => new Promise((r) => w.on('open', r))));
    const got = new Promise((r) => wsB.on('message', (d) => { const m = JSON.parse(d); if (m.type === 'message') r(m.message); }));
    wsA.send(JSON.stringify({ type: 'send', to: 'bob', text: 'halo bob' }));
    const m = await got;
    assert.equal(m.text, 'halo bob'); assert.equal(m.from, 'alice');

    assert.equal((await get('/api/messages/alice', b.token)).messages.length, 1);
    const chats = (await get('/api/chats', b.token)).chats;
    assert.equal(chats[0].peer, 'alice'); assert.equal(chats[0].online, true);
    assert.equal((await fetch(base + '/api/chats')).status, 401);
    console.log('Semua tes lolos');
    wsA.close(); wsB.close();
  } catch (e) { console.error('GAGAL:', e); process.exitCode = 1; }
  setTimeout(() => process.exit(process.exitCode || 0), 300);
});
