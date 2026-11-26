// API des Rechners: Konten, Verlauf (Fortschritt) und Rangliste in der D1-Datenbank.
// `db` ist eine D1-Datenbank (env.DB) – in den Node-Tests ein kleiner Nachbau auf node:sqlite.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS accounts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     login TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     pw_hash TEXT NOT NULL,
     salt TEXT NOT NULL,
     created INTEGER NOT NULL,
     duels_played INTEGER NOT NULL DEFAULT 0,
     duels_won INTEGER NOT NULL DEFAULT 0,
     total_correct INTEGER NOT NULL DEFAULT 0,
     calcs INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token TEXT PRIMARY KEY,
     account_id INTEGER NOT NULL,
     created INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS history (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     account_id INTEGER NOT NULL,
     expr TEXT NOT NULL,
     result TEXT NOT NULL,
     created INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS history_acc ON history(account_id, id)`,
  `CREATE INDEX IF NOT EXISTS sessions_acc ON sessions(account_id)`,
];

const ready = new WeakMap();
export function ensureSchema(db) {
  if (!ready.has(db)) {
    ready.set(db, db.batch(SCHEMA.map((s) => db.prepare(s))).catch((e) => { ready.delete(db); throw e; }));
  }
  return ready.get(db);
}

const HISTORY_MAX = 200;
const SESSION_DAYS = 90;
const NAME_RE = /^[A-Za-z0-9ÄÖÜäöüß_-]{3,20}$/;

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));

async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100000 }, key, 256);
  return hex(bits);
}
function sameHash(a, b) {
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const publicUser = (a) => ({
  id: a.id, name: a.name, created: a.created,
  duelsPlayed: a.duels_played, duelsWon: a.duels_won, totalCorrect: a.total_correct, calcs: a.calcs,
});

export async function accountByToken(db, token) {
  if (!token || typeof token !== 'string' || token.length > 100) return null;
  await ensureSchema(db);
  const minCreated = Date.now() - SESSION_DAYS * 864e5;
  return db.prepare(`SELECT a.* FROM sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token = ? AND s.created > ?`)
    .bind(token, minCreated).first();
}

// Ergebnis eines Rechen-Duells speichern (vom Duell-Server aufgerufen).
export async function recordDuel(db, accountId, { won, correct }) {
  await ensureSchema(db);
  await db.prepare(`UPDATE accounts SET duels_played = duels_played + 1, duels_won = duels_won + ?, total_correct = total_correct + ? WHERE id = ?`)
    .bind(won ? 1 : 0, Math.max(0, correct | 0), accountId).run();
}

async function newSession(db, accountId) {
  const token = randomHex(24);
  await db.prepare(`INSERT INTO sessions (token, account_id, created) VALUES (?, ?, ?)`).bind(token, accountId, Date.now()).run();
  return token;
}

const ok = (data) => ({ status: 200, data });
const err = (status, error) => ({ status, data: { error } });

export async function handleApi(db, { method, path, body = {}, token = '', version = 'dev' }) {
  if (path === '/api/health') {
    let dbOk = false;
    try { await ensureSchema(db); dbOk = !!(await db.prepare('SELECT 1 AS x').first()); } catch (e) { console.error(e); }
    return { status: dbOk ? 200 : 503, data: { ok: dbOk, db: dbOk, version } };
  }
  await ensureSchema(db);

  if (path === '/api/register' && method === 'POST') {
    const name = String(body.name || '').trim();
    const password = String(body.password || '');
    if (!NAME_RE.test(name)) return err(400, 'Name: 3–20 Zeichen (Buchstaben, Ziffern, _ und -).');
    if (password.length < 6 || password.length > 200) return err(400, 'Passwort: mindestens 6 Zeichen.');
    const login = name.toLowerCase();
    if (await db.prepare('SELECT id FROM accounts WHERE login = ?').bind(login).first()) return err(409, 'Dieser Name ist schon vergeben.');
    const salt = randomHex(16);
    const pw = await hashPassword(password, salt);
    try {
      await db.prepare('INSERT INTO accounts (login, name, pw_hash, salt, created) VALUES (?, ?, ?, ?, ?)')
        .bind(login, name, pw, salt, Date.now()).run();
    } catch { return err(409, 'Dieser Name ist schon vergeben.'); }
    const a = await db.prepare('SELECT * FROM accounts WHERE login = ?').bind(login).first();
    return ok({ token: await newSession(db, a.id), user: publicUser(a) });
  }

  if (path === '/api/login' && method === 'POST') {
    const login = String(body.name || '').trim().toLowerCase();
    const password = String(body.password || '');
    const a = login && await db.prepare('SELECT * FROM accounts WHERE login = ?').bind(login).first();
    if (!a || !sameHash(await hashPassword(password, a.salt), a.pw_hash)) return err(401, 'Name oder Passwort falsch.');
    return ok({ token: await newSession(db, a.id), user: publicUser(a) });
  }

  if (path === '/api/leaderboard' && method === 'GET') {
    const { results } = await db.prepare(
      `SELECT name, duels_won, duels_played, total_correct FROM accounts
       WHERE duels_played > 0 ORDER BY duels_won DESC, total_correct DESC, duels_played ASC LIMIT 20`).all();
    return ok({ leaders: results.map((r) => ({ name: r.name, won: r.duels_won, played: r.duels_played, correct: r.total_correct })) });
  }

  // Ab hier nur mit Anmeldung
  const me = await accountByToken(db, token);
  if (!me) return err(401, 'Bitte anmelden.');

  if (path === '/api/me' && method === 'GET') return ok({ user: publicUser(me) });

  if (path === '/api/logout' && method === 'POST') {
    await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return ok({ ok: true });
  }

  if (path === '/api/history' && method === 'GET') {
    const { results } = await db.prepare('SELECT id, expr, result, created FROM history WHERE account_id = ? ORDER BY id DESC LIMIT ?')
      .bind(me.id, HISTORY_MAX).all();
    return ok({ history: results });
  }

  if (path === '/api/history' && method === 'POST') {
    const items = Array.isArray(body.items) ? body.items : [body];
    const clean = items
      .map((x) => ({ expr: String(x.expr || '').slice(0, 300), result: String(x.result || '').slice(0, 100), created: Number(x.created) || Date.now() }))
      .filter((x) => x.expr && x.result)
      .slice(0, 50);
    if (!clean.length) return err(400, 'Keine Rechnung.');
    await db.batch([
      ...clean.map((x) => db.prepare('INSERT INTO history (account_id, expr, result, created) VALUES (?, ?, ?, ?)').bind(me.id, x.expr, x.result, Math.min(x.created, Date.now()))),
      db.prepare('UPDATE accounts SET calcs = calcs + ? WHERE id = ?').bind(clean.length, me.id),
      db.prepare(`DELETE FROM history WHERE account_id = ? AND id NOT IN (SELECT id FROM history WHERE account_id = ? ORDER BY id DESC LIMIT ${HISTORY_MAX})`).bind(me.id, me.id),
    ]);
    return ok({ ok: true, saved: clean.length });
  }

  if (path === '/api/history' && method === 'DELETE') {
    await db.prepare('DELETE FROM history WHERE account_id = ?').bind(me.id).run();
    return ok({ ok: true });
  }

  if (path === '/api/account/delete' && method === 'POST') {
    if (!sameHash(await hashPassword(String(body.password || ''), me.salt), me.pw_hash)) return err(401, 'Passwort falsch.');
    await db.batch([
      db.prepare('DELETE FROM history WHERE account_id = ?').bind(me.id),
      db.prepare('DELETE FROM sessions WHERE account_id = ?').bind(me.id),
      db.prepare('DELETE FROM accounts WHERE id = ?').bind(me.id),
    ]);
    return ok({ ok: true });
  }

  return err(404, 'Unbekannte Anfrage.');
}
