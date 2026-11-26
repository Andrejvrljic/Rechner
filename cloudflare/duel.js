// Rechen-Duell: mehrere Spieler bekommen dieselbe Kopfrechenaufgabe, wer zuerst richtig antwortet,
// holt den Punkt. Reine Spiellogik ohne Cloudflare-Abhängigkeit (wird im Durable Object und in Tests benutzt).

export const MAX_PLAYERS = 8;

function rnd(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }

// Aufgabe passend zur Runde (wird mit jeder Runde etwas schwerer). Antwort ist immer ganzzahlig.
export function makeTask(round) {
  const lvl = Math.min(4, Math.floor(round / 3));
  const op = ['+', '−', '×', '÷'][rnd(0, lvl < 1 ? 1 : 3)];
  const big = [20, 50, 100, 200, 500][lvl];
  if (op === '+') { const a = rnd(2, big), b = rnd(2, big); return { text: `${a} + ${b}`, answer: a + b }; }
  if (op === '−') { const a = rnd(2, big), b = rnd(1, a); return { text: `${a} − ${b}`, answer: a - b }; }
  const m = [9, 12, 15, 20, 25][lvl];
  const a = rnd(2, m), b = rnd(2, m);
  if (op === '×') return { text: `${a} × ${b}`, answer: a * b };
  return { text: `${a * b} ÷ ${a}`, answer: b };
}

export function parseAnswer(v) {
  const s = String(v ?? '').trim().replace(/\s/g, '').replace(',', '.').replace(/^−/, '-');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Number(s);
}

export class DuelRoom {
  // opts: { code, roundMs, pauseMs, onFinish(players) , setTimer, clearTimer }
  constructor(opts = {}) {
    this.code = opts.code || '????';
    this.roundMs = opts.roundMs ?? 20000;
    this.pauseMs = opts.pauseMs ?? 2000;
    this.onFinish = opts.onFinish || (() => {});
    this.setTimer = opts.setTimer || ((f, ms) => setTimeout(f, ms));
    this.clearTimer = opts.clearTimer || ((t) => clearTimeout(t));
    this.players = new Map(); // id -> {id, name, accountId, score, send, ready}
    this.nextId = 1;
    this.state = 'lobby'; // lobby | playing
    this.round = 0; this.total = 0; this.task = null; this.timer = null; this.roundOpen = false;
  }

  get hostId() { return this.players.size ? this.players.keys().next().value : null; }

  playersPublic() {
    return [...this.players.values()].map((p) => ({ id: p.id, name: p.name, score: p.score, host: p.id === this.hostId, account: !!p.accountId }));
  }
  broadcast(msg) { const t = JSON.stringify(msg); for (const p of this.players.values()) { try { p.send(t); } catch {} } }
  lobby() { this.broadcast({ type: 'lobby', room: this.code, state: this.state, players: this.playersPublic() }); }

  // Neuer Spieler. Gibt die Spieler-ID zurück oder null (Raum voll).
  join({ name, accountId = null, send }) {
    if (this.players.size >= MAX_PLAYERS) { send(JSON.stringify({ type: 'error', msg: 'Der Raum ist voll.' })); return null; }
    if (accountId && [...this.players.values()].some((p) => p.accountId === accountId)) {
      send(JSON.stringify({ type: 'error', msg: 'Du bist schon in diesem Raum.' })); return null;
    }
    let clean = String(name || '').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 20) || 'Gast';
    const taken = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    let n = 2; const base = clean;
    while (taken.has(clean.toLowerCase())) clean = `${base} ${n++}`;
    const id = this.nextId++;
    this.players.set(id, { id, name: clean, accountId, score: 0, correct: 0, send });
    send(JSON.stringify({ type: 'welcome', you: id, name: clean, room: this.code }));
    this.lobby();
    if (this.state === 'playing' && this.task && this.roundOpen) {
      send(JSON.stringify({ type: 'task', n: this.round, total: this.total, text: this.task.text, ms: this.roundMs }));
    }
    return id;
  }

  leave(id) {
    if (!this.players.delete(id)) return;
    if (!this.players.size) { this.reset(); return; }
    this.lobby();
  }

  reset() {
    if (this.timer) this.clearTimer(this.timer);
    this.timer = null; this.state = 'lobby'; this.task = null; this.roundOpen = false; this.round = 0;
  }

  message(id, msg) {
    const p = this.players.get(id);
    if (!p || !msg || typeof msg !== 'object') return;
    if (msg.type === 'start') {
      if (id !== this.hostId) return p.send(JSON.stringify({ type: 'error', msg: 'Nur der Gastgeber kann starten.' }));
      if (this.state === 'playing') return;
      this.start(Math.max(1, Math.min(20, Number(msg.rounds) || 10)));
    } else if (msg.type === 'answer') {
      if (this.state !== 'playing' || !this.roundOpen) return;
      if (parseAnswer(msg.value) === this.task.answer) this.finishRound(p);
      else p.send(JSON.stringify({ type: 'wrong' }));
    }
  }

  start(rounds) {
    this.state = 'playing'; this.total = rounds; this.round = 0;
    for (const p of this.players.values()) { p.score = 0; p.correct = 0; }
    this.lobby();
    this.nextRound();
  }

  nextRound() {
    if (this.state !== 'playing') return;
    if (this.round >= this.total) return this.end();
    this.round++;
    this.task = makeTask(this.round - 1);
    this.roundOpen = true;
    this.broadcast({ type: 'task', n: this.round, total: this.total, text: this.task.text, ms: this.roundMs });
    this.timer = this.setTimer(() => this.finishRound(null), this.roundMs);
  }

  finishRound(winner) {
    if (!this.roundOpen) return;
    this.roundOpen = false;
    if (this.timer) this.clearTimer(this.timer);
    if (winner) { winner.score++; winner.correct++; }
    this.broadcast({ type: 'round', n: this.round, answer: this.task.answer, winner: winner ? { id: winner.id, name: winner.name } : null, players: this.playersPublic() });
    this.timer = this.setTimer(() => this.nextRound(), this.pauseMs);
  }

  end() {
    const ranking = this.playersPublic().sort((a, b) => b.score - a.score);
    const top = ranking.length ? ranking[0].score : 0;
    const winners = ranking.filter((r) => r.score === top && top > 0).map((r) => r.id);
    const results = [...this.players.values()].map((p) => ({ accountId: p.accountId, correct: p.correct, won: winners.includes(p.id) && winners.length === 1 }));
    this.broadcast({ type: 'end', ranking, winners });
    this.reset();
    this.lobby();
    try { this.onFinish(results); } catch (e) { console.error(e); }
  }
}
