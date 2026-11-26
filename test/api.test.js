import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleApi, recordDuel, accountByToken } from '../cloudflare/api.js';
import { memoryD1 } from './d1-shim.js';

const db = memoryD1();
const call = (method, path, body, token) => handleApi(db, { method, path, body, token, version: 'v-test' });

test('Gesundheit meldet Version und Datenbank', async () => {
  const r = await call('GET', '/api/health');
  assert.deepEqual(r, { status: 200, data: { ok: true, db: true, version: 'v-test' } });
});

test('Konto: registrieren, anmelden, Fehlerfälle', async () => {
  assert.equal((await call('POST', '/api/register', { name: 'ab', password: 'geheim1' })).status, 400);
  assert.equal((await call('POST', '/api/register', { name: 'Anna', password: '123' })).status, 400);
  const r = await call('POST', '/api/register', { name: 'Anna', password: 'geheim1' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.name, 'Anna');
  assert.equal((await call('POST', '/api/register', { name: 'anna', password: 'geheim1' })).status, 409);
  assert.equal((await call('POST', '/api/login', { name: 'ANNA', password: 'falsch!' })).status, 401);
  const l = await call('POST', '/api/login', { name: 'ANNA', password: 'geheim1' });
  assert.equal(l.status, 200);
  assert.equal((await call('GET', '/api/me', {}, l.data.token)).data.user.name, 'Anna');
  assert.equal((await call('GET', '/api/me', {}, 'quatsch')).status, 401);
  await call('POST', '/api/logout', {}, l.data.token);
  assert.equal((await call('GET', '/api/me', {}, l.data.token)).status, 401);
});

test('Verlauf speichern, begrenzen, leeren', async () => {
  const { data: { token } } = await call('POST', '/api/register', { name: 'Bert', password: 'geheim1' });
  assert.equal((await call('POST', '/api/history', { expr: '1+1', result: '2' }, token)).status, 200);
  const items = Array.from({ length: 50 }, (_, i) => ({ expr: `${i}+1`, result: String(i + 1) }));
  for (let k = 0; k < 5; k++) await call('POST', '/api/history', { items }, token);
  const h = await call('GET', '/api/history', {}, token);
  assert.equal(h.data.history.length, 200);
  assert.equal(h.data.history[0].expr, '49+1');
  assert.equal((await call('GET', '/api/me', {}, token)).data.user.calcs, 251);
  await call('DELETE', '/api/history', {}, token);
  assert.equal((await call('GET', '/api/history', {}, token)).data.history.length, 0);
  assert.equal((await call('GET', '/api/history')).status, 401);
});

test('Rangliste und Konto löschen', async () => {
  const { data: { token, user } } = await call('POST', '/api/register', { name: 'Cleo', password: 'geheim1' });
  await recordDuel(db, user.id, { won: true, correct: 5 });
  await recordDuel(db, user.id, { won: false, correct: 1 });
  const b = await call('GET', '/api/leaderboard');
  assert.deepEqual(b.data.leaders[0], { name: 'Cleo', won: 1, played: 2, correct: 6 });
  assert.equal((await call('POST', '/api/account/delete', { password: 'nein!!' }, token)).status, 401);
  assert.equal((await call('POST', '/api/account/delete', { password: 'geheim1' }, token)).status, 200);
  assert.equal(await accountByToken(db, token), null);
  assert.equal((await call('GET', '/api/leaderboard')).data.leaders.length, 0);
  assert.equal((await call('POST', '/api/login', { name: 'Cleo', password: 'geheim1' })).status, 401);
});
