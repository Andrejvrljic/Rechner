// Live-Test gegen die veröffentlichte App (oder `wrangler dev`): Seite, Datenbank und Multiplayer.
// Läuft nur mit TEST_URL, z. B.  TEST_URL=https://rechner.dinnerboneagg.workers.dev npm test
// Legt Testkonten mit dem Präfix "rtest" an und löscht sie am Ende wieder.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../public/js/calc.js';

const BASE = (process.env.TEST_URL || '').replace(/\/$/, '');
const skip = BASE ? false : 'TEST_URL nicht gesetzt';
const tag = Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 5);
const accounts = [];

async function api(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function makeAccount(n) {
  const name = `rtest${tag}${n}`, password = 'test-' + tag;
  const r = await api('/api/register', { method: 'POST', body: { name, password } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const acc = { name, password, token: r.data.token, id: r.data.user.id };
  accounts.push(acc);
  return acc;
}

after(async () => {
  if (!BASE) return;
  for (const a of accounts) await api('/api/account/delete', { method: 'POST', token: a.token, body: { password: a.password } }).catch(() => {});
});

// WebSocket-Spieler, der Nachrichten sammelt und auf bestimmte warten kann
function player(room, hello) {
  const ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws?room=' + room);
  const msgs = []; const waiters = [];
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data); msgs.push(m);
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
  });
  const opened = new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', () => rej(new Error('WebSocket-Fehler'))); });
  const wait = (pred, ms = 15000) => {
    const hit = msgs.find(pred); if (hit) { msgs.splice(msgs.indexOf(hit), 1); return Promise.resolve(hit); }
    return new Promise((resolve, reject) => {
      const w = { pred: (m) => { if (pred(m)) { msgs.splice(msgs.indexOf(m), 1); return true; } return false; }, resolve };
      waiters.push(w);
      setTimeout(() => reject(new Error('Zeitüberschreitung beim Warten auf Nachricht')), ms).unref?.();
    });
  };
  return {
    ws, wait,
    async hello() { await opened; ws.send(JSON.stringify({ type: 'hello', ...hello })); return wait((m) => m.type === 'welcome'); },
    send: (m) => ws.send(JSON.stringify(m)),
    close: () => ws.close(),
  };
}

test('Seite und Dateien werden ausgeliefert', { skip }, async () => {
  const html = await (await fetch(BASE + '/')).text();
  assert.match(html, /<title>Rechner<\/title>/);
  for (const f of ['/style.css', '/js/app.js', '/js/calc.js', '/manifest.webmanifest', '/icon-192.png']) {
    const r = await fetch(BASE + f);
    assert.equal(r.status, 200, f);
  }
});

test('Gesundheit: Datenbank erreichbar', { skip }, async () => {
  const r = await api('/api/health');
  assert.equal(r.status, 200);
  assert.equal(r.data.db, true);
  if (process.env.EXPECT_VERSION) assert.equal(r.data.version, process.env.EXPECT_VERSION);
});

test('Datenbank: Konto, Anmeldung, Verlauf', { skip }, async () => {
  const a = await makeAccount('a');
  const login = await api('/api/login', { method: 'POST', body: { name: a.name.toUpperCase(), password: a.password } });
  assert.equal(login.status, 200);
  assert.equal((await api('/api/login', { method: 'POST', body: { name: a.name, password: 'falsch-falsch' } })).status, 401);
  assert.equal((await api('/api/history', { method: 'POST', token: a.token, body: { expr: '6×7', result: '42' } })).status, 200);
  const h = await api('/api/history', { token: a.token });
  assert.equal(h.data.history[0].result, '42');
  const me = await api('/api/me', { token: login.data.token });
  assert.equal(me.data.user.calcs, 1);
  assert.equal((await api('/api/leaderboard')).status, 200);
});

test('Multiplayer: Rechen-Duell mit zwei Spielern', { skip }, async () => {
  const b = await makeAccount('b');
  const c = await makeAccount('c');
  const room = ('T' + tag).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const p1 = player(room, { token: b.token });
  const p2 = player(room, { token: c.token });
  try {
    const w1 = await p1.hello();
    const w2 = await p2.hello();
    assert.equal(w1.name, b.name);
    await p1.wait((m) => m.type === 'lobby' && m.players.length === 2);
    p1.send({ type: 'start', rounds: 2 });
    for (let n = 1; n <= 2; n++) {
      const t = await p2.wait((m) => m.type === 'task' && m.n === n);
      await p1.wait((m) => m.type === 'task' && m.n === n);
      p2.send({ type: 'answer', value: '-999' });
      await p2.wait((m) => m.type === 'wrong');
      p2.send({ type: 'answer', value: String(evaluate(t.text)) });
      const r = await p1.wait((m) => m.type === 'round' && m.n === n);
      assert.equal(r.winner.id, w2.you);
    }
    const end = await p1.wait((m) => m.type === 'end');
    assert.deepEqual(end.winners, [w2.you]);
    // Ergebnis landet in der Datenbank
    let me;
    for (let i = 0; i < 20; i++) {
      me = (await api('/api/me', { token: c.token })).data.user;
      if (me.duelsWon === 1) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.equal(me.duelsWon, 1);
    assert.equal(me.totalCorrect, 2);
    const loser = (await api('/api/me', { token: b.token })).data.user;
    assert.equal(loser.duelsPlayed, 1);
    assert.equal(loser.duelsWon, 0);
    const board = (await api('/api/leaderboard')).data.leaders;
    assert.ok(board.some((l) => l.name === c.name && l.won === 1));
  } finally { p1.close(); p2.close(); }
});

test('Testkonten werden gelöscht', { skip }, async () => {
  for (const a of accounts.splice(0)) {
    const r = await api('/api/account/delete', { method: 'POST', token: a.token, body: { password: a.password } });
    assert.equal(r.status, 200);
    assert.equal((await api('/api/login', { method: 'POST', body: { name: a.name, password: a.password } })).status, 401);
  }
});
