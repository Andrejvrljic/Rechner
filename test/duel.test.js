import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DuelRoom, makeTask, parseAnswer, MAX_PLAYERS } from '../cloudflare/duel.js';
import { evaluate } from '../public/js/calc.js';

// Uhr zum Vorspulen: Timer laufen nur, wenn der Test es sagt
function fakeTimers() {
  let q = [];
  return {
    setTimer: (f, ms) => { const t = { f, ms }; q.push(t); return t; },
    clearTimer: (t) => { q = q.filter((x) => x !== t); },
    runNext() { const t = q.shift(); if (t) t.f(); return !!t; },
    get pending() { return q.length; },
  };
}
function client() { const msgs = []; return { msgs, send: (t) => msgs.push(JSON.parse(t)), last: (type) => msgs.filter((m) => m.type === type).at(-1) }; }

test('Aufgaben sind immer ganzzahlig lösbar und passen zum Rechenkern', () => {
  for (let r = 0; r < 300; r++) {
    const t = makeTask(r % 15);
    assert.ok(Number.isInteger(t.answer) && t.answer >= 0, t.text);
    assert.equal(evaluate(t.text), t.answer, t.text);
  }
});

test('Antworten werden tolerant gelesen', () => {
  assert.equal(parseAnswer(' 42 '), 42);
  assert.equal(parseAnswer('2,0'), 2);
  assert.ok(Number.isNaN(parseAnswer('4x')));
  assert.ok(Number.isNaN(parseAnswer('')));
});

test('ganzes Duell: Punkte, Gewinner, Ergebnis', () => {
  const tm = fakeTimers();
  let results = null;
  const room = new DuelRoom({ code: 'ABCD', ...tm, onFinish: (r) => { results = r; } });
  const a = client(), b = client();
  const ia = room.join({ name: 'Anna', accountId: 7, send: a.send });
  const ib = room.join({ name: 'anna', send: b.send });
  assert.equal(b.last('welcome').name, 'anna 2'); // gleicher Name wird unterschieden
  assert.equal(a.last('lobby').players.length, 2);

  room.message(ib, { type: 'start', rounds: 3 });
  assert.equal(b.last('error').msg, 'Nur der Gastgeber kann starten.');
  room.message(ia, { type: 'start', rounds: 3 });
  assert.equal(a.last('task').n, 1);

  // Runde 1: B antwortet falsch, A richtig
  room.message(ib, { type: 'answer', value: '-1' });
  assert.equal(b.last('wrong').type, 'wrong');
  room.message(ia, { type: 'answer', value: String(evaluate(a.last('task').text)) });
  assert.equal(b.last('round').winner.id, ia);
  room.message(ib, { type: 'answer', value: String(evaluate(a.last('task').text)) }); // zu spät
  assert.equal(b.last('round').n, 1);
  tm.runNext(); // Pause
  // Runde 2: niemand antwortet, Zeit läuft ab
  assert.equal(a.last('task').n, 2);
  tm.runNext();
  assert.equal(a.last('round').winner, null);
  tm.runNext();
  // Runde 3: A gewinnt wieder
  room.message(ia, { type: 'answer', value: String(evaluate(a.last('task').text)) });
  tm.runNext();
  const end = b.last('end');
  assert.deepEqual(end.winners, [ia]);
  assert.equal(end.ranking[0].score, 2);
  assert.equal(room.state, 'lobby');
  assert.deepEqual(results.find((r) => r.accountId === 7), { accountId: 7, correct: 2, won: true });
  assert.equal(tm.pending, 0);
});

test('Gastgeber wechselt, Raum ist begrenzt, Konto nur einmal', () => {
  const room = new DuelRoom({ ...fakeTimers() });
  const ids = [];
  for (let i = 0; i < MAX_PLAYERS; i++) ids.push(room.join({ name: 'P' + i, accountId: i === 0 ? 1 : null, send: () => {} }));
  const extra = client();
  assert.equal(room.join({ name: 'X', send: extra.send }), null);
  assert.equal(extra.last('error').msg, 'Der Raum ist voll.');
  room.leave(ids[1]);
  const dup = client();
  assert.equal(room.join({ name: 'Y', accountId: 1, send: dup.send }), null);
  room.leave(ids[0]);
  assert.equal(room.hostId, ids[2]);
});
