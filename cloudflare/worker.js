// Rechner auf Cloudflare: der Worker liefert die App aus und beantwortet die API (D1-Datenbank),
// ein Durable Object pro Raum betreibt das Rechen-Duell in Echtzeit über WebSocket.
import { handleApi, accountByToken, recordDuel } from './api.js';
import { DuelRoom } from './duel.js';

const json = (status, data) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const ROOM_RE = /^[A-Z0-9]{4,6}$/;

export class DuelDO {
  constructor(state, env) {
    this.env = env;
    this.room = null;
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Nur WebSocket', { status: 426 });
    const url = new URL(request.url);
    const code = (url.searchParams.get('room') || '').toUpperCase();
    if (!this.room) {
      this.room = new DuelRoom({
        code,
        onFinish: (results) => Promise.all(results.filter((r) => r.accountId)
          .map((r) => recordDuel(this.env.DB, r.accountId, r).catch((e) => console.error(e)))),
      });
    }
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    let id = null;
    const send = (t) => server.send(t);
    server.addEventListener('message', async (e) => {
      let msg; try { msg = JSON.parse(typeof e.data === 'string' ? e.data : ''); } catch { return; }
      if (id === null) {
        if (msg.type !== 'hello') return;
        id = -1; // während der Anmeldung keine zweite hello-Nachricht annehmen
        let acc = null;
        try { acc = msg.token ? await accountByToken(this.env.DB, String(msg.token)) : null; } catch (err) { console.error(err); }
        id = this.room.join({ name: acc ? acc.name : msg.name, accountId: acc ? acc.id : null, send });
        if (id === null) server.close(1008, 'abgelehnt');
        return;
      }
      if (id > 0) this.room.message(id, msg);
    });
    const bye = () => { if (id > 0) this.room.leave(id); id = 0; };
    server.addEventListener('close', (e) => { bye(); try { server.close(1000, 'tschüss'); } catch {} });
    server.addEventListener('error', bye);
    return new Response(null, { status: 101, webSocket: client });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('Nur WebSocket', { status: 426 });
      const code = (url.searchParams.get('room') || '').toUpperCase();
      if (!ROOM_RE.test(code)) return new Response('Ungültiger Raum', { status: 400 });
      return env.DUEL.get(env.DUEL.idFromName('room:' + code)).fetch(request);
    }

    if (url.pathname.startsWith('/api/')) {
      try {
        let body = {};
        if (request.method === 'POST') {
          const text = await request.text();
          if (text.length > 64 * 1024) return json(413, { error: 'Zu groß.' });
          try { body = JSON.parse(text || '{}'); } catch { return json(400, { error: 'Ungültige Anfrage.' }); }
          if (!body || typeof body !== 'object') body = {};
        }
        const r = await handleApi(env.DB, {
          method: request.method, path: url.pathname, body,
          token: (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''),
          version: env.VERSION || 'dev',
        });
        return json(r.status, r.data);
      } catch (e) {
        console.error(e);
        return json(500, { error: 'Serverfehler' });
      }
    }

    const res = await env.ASSETS.fetch(request);
    // HTML und JS nie lange zwischenspeichern, damit jede neue Version sofort ankommt
    if (/\.(html|js|css|webmanifest)$|\/$/.test(url.pathname)) {
      const h = new Headers(res.headers);
      h.set('cache-control', 'no-cache');
      return new Response(res.body, { status: res.status, headers: h });
    }
    return res;
  },
};
