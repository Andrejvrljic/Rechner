// Kleiner Nachbau der Cloudflare-D1-Schnittstelle auf node:sqlite – nur für die lokalen Tests.
import { DatabaseSync } from 'node:sqlite';

export function memoryD1() {
  const sql = new DatabaseSync(':memory:');
  const stmt = (q, args = []) => ({
    _q: q, _a: args,
    bind: (...a) => stmt(q, a),
    async first() { return sql.prepare(q).get(...args) ?? null; },
    async all() { return { results: sql.prepare(q).all(...args) }; },
    async run() { const r = sql.prepare(q).run(...args); return { meta: { changes: r.changes } }; },
  });
  return {
    prepare: (q) => stmt(q),
    async batch(list) {
      sql.exec('BEGIN');
      try { const out = list.map((s) => sql.prepare(s._q).run(...s._a)); sql.exec('COMMIT'); return out; }
      catch (e) { sql.exec('ROLLBACK'); throw e; }
    },
  };
}
