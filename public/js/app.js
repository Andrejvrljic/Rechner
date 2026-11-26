import { calc, format } from './calc.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

function toast(text) {
  const t = $('toast'); t.textContent = text; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 1800);
}

// ───────────────────────── API & Konto ─────────────────────────
let token = store.get('rechner.token', '');
let user = null;

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {}; try { data = await res.json(); } catch {}
  if (!res.ok) { const e = new Error(data.error || 'Fehler ' + res.status); e.status = res.status; throw e; }
  return data;
}

// ───────────────────────── Tabs ─────────────────────────
function showView(name) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + name));
  if (name === 'board') loadBoard();
  if (name === 'account' && user) loadMe();
}
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

// ───────────────────────── Rechner ─────────────────────────
let expr = '';
let done = false;      // gerade "=" gedrückt
let ans = '';          // letztes Ergebnis als Eingabetext
let second = false;    // 2nd-Taste
let degrees = store.get('rechner.deg', true);
let lastResultText = '';

const OPS = ['+', '−', '×', '÷', '^'];
const FN_TOKENS = ['asin(', 'acos(', 'atan(', 'sin(', 'cos(', 'tan(', 'ln(', 'log(', '√(', '∛('];
const lastChar = () => expr.slice(-1);
const isDigit = (c) => /[0-9]/.test(c);
const endsWithValue = () => /[0-9πe)!%²³]$/.test(expr);

function toInput(v) {
  return format(v, { comma: false }).replace('.', ',').replace(/^-/, '−');
}

function startFromAnswer() { if (done) { expr = ans; done = false; } }
function startFresh() { if (done) { expr = ''; done = false; } }

function press(k) {
  switch (k) {
    case 'AC': expr = ''; done = false; break;
    case '⌫':
      if (done) { done = false; break; }
      { const fn = FN_TOKENS.find((f) => expr.endsWith(f)); expr = fn ? expr.slice(0, -fn.length) : expr.slice(0, -1); }
      break;
    case '=': return equals();
    case ',': {
      startFresh();
      const m = expr.match(/[0-9,]*$/)[0];
      if (m.includes(',')) return;
      expr += m === '' ? '0,' : ',';
      break;
    }
    case '+': case '−': case '×': case '÷': case '^': {
      startFromAnswer();
      if (expr === '' || lastChar() === '(') { if (k === '−') expr += '−'; else if (expr === '') expr = '0' + k; break; }
      const lc = lastChar();
      if (OPS.includes(lc)) {
        if (k === '−' && lc !== '−' && lc !== '+') { expr += '−'; break; }  // 3×−2
        expr = expr.replace(/[+−×÷^]+$/, '') + k;
        break;
      }
      if (lc === ',') expr = expr.slice(0, -1);
      expr += k;
      break;
    }
    case '%': case '!':
      startFromAnswer();
      if (endsWithValue()) expr += k;
      break;
    case '(': startFresh(); expr += '('; break;
    case ')': {
      const open = (expr.match(/\(/g) || []).length - (expr.match(/\)/g) || []).length;
      if (open > 0 && endsWithValue()) expr += ')';
      break;
    }
    case 'π': case 'e': startFresh(); expr += k; break;
    case 'sin': case 'cos': case 'tan': case 'asin': case 'acos': case 'atan': case 'ln': case 'log':
    case '√': case '∛': {
      const f = k + '(';
      if (done) { expr = f + ans + ')'; done = false; } else expr += f;
      break;
    }
    case 'eˣ': if (done) { expr = 'e^(' + ans + ')'; done = false; } else expr += 'e^('; break;
    case '10ˣ': if (done) { expr = '10^(' + ans + ')'; done = false; } else expr += '10^('; break;
    case 'x²': case 'x³':
      startFromAnswer();
      if (endsWithValue()) expr += k === 'x²' ? '²' : '³';
      break;
    case '1/x':
      startFromAnswer();
      if (expr) expr = '1÷(' + expr + ')';
      break;
    case '±': toggleSign(); break;
    case '2nd': second = !second; renderSecond(); return;
    default:
      if (isDigit(k)) {
        startFresh();
        if (/(^|[^0-9,])0$/.test(expr)) expr = expr.slice(0, -1); // führende Null ersetzen
        expr += k;
      }
  }
  if (second && k !== '2nd' && /[a-zˣ³∛√]/.test(k)) { second = false; renderSecond(); }
  render();
}

function toggleSign() {
  startFromAnswer();
  const m = expr.match(/([0-9,]+|π|e)$/);
  if (!m) { if (expr === '' || OPS.includes(lastChar()) || lastChar() === '(') { if (lastChar() !== '−') expr += '−'; } render(); return; }
  const head = expr.slice(0, -m[0].length);
  const prev = head.slice(-1);
  if (prev === '−') {
    const before = head.slice(-2, -1);
    expr = (before === '' || OPS.includes(before) || before === '(') ? head.slice(0, -1) + m[0] : head.slice(0, -1) + '+' + m[0];
  } else if (prev === '+') expr = head.slice(0, -1) + '−' + m[0];
  else expr = head + '−' + m[0];
}

function equals() {
  if (!expr || done) return;
  const open = (expr.match(/\(/g) || []).length - (expr.match(/\)/g) || []).length;
  if (open > 0) expr += ')'.repeat(open);
  const r = calc(expr, { degrees });
  if (!r.ok) { showError(r.error); return; }
  const text = format(r.value);
  addHistory(expr, text);
  lastResultText = text;
  ans = toInput(r.value);
  done = true;
  render();
}

function showError(msg) {
  const el = $('result');
  el.textContent = msg; el.className = 'result err';
  el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
}

function render() {
  const ex = $('expr'), res = $('result');
  if (done) {
    ex.textContent = expr + ' ='; ex.className = 'expr small';
    res.textContent = lastResultText; res.className = 'result final';
    fit(res, 48);
  } else {
    ex.textContent = expr || '0'; ex.className = 'expr';
    if (expr) { const c = document.createElement('span'); c.className = 'caret'; ex.appendChild(c); }
    fit(ex, 34);
    // Vorschau, sobald etwas zu rechnen ist
    const r = /[+−×÷^%!(a-zπ√∛²³]/.test(expr.replace(/^−/, '')) ? calc(expr, { degrees }) : null;
    res.textContent = r && r.ok ? '= ' + format(r.value) : '';
    res.className = 'result';
  }
  $('k-ac').textContent = expr && !done ? 'C' : 'AC';
}

function fit(el, max) {
  const len = el.textContent.length;
  el.style.fontSize = len > 12 ? Math.max(18, Math.round(max * 12 / len)) + 'px' : '';
}

function renderSecond() {
  $('k-2nd').classList.toggle('on', second);
  document.querySelectorAll('[data-k2]').forEach((b) => {
    b.textContent = second ? b.dataset.l2 : b.dataset.k;
    if (b.dataset.k === 'x²' && !second) b.textContent = 'x²';
  });
}

function renderAngle() {
  $('angle-ind').textContent = degrees ? 'DEG' : 'RAD';
  $('btn-angle').textContent = degrees ? 'DEG' : 'RAD';
}

document.querySelectorAll('.k').forEach((b) => b.addEventListener('click', () => {
  const k = second && b.dataset.k2 ? b.dataset.k2 : b.dataset.k;
  press(k);
}));

document.querySelectorAll('.seg[data-mode]').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
function setMode(m) {
  document.querySelectorAll('.seg[data-mode]').forEach((x) => x.classList.toggle('active', x.dataset.mode === m));
  $('sci-keys').hidden = m !== 'sci';
  $('view-calc').classList.toggle('sci', m === 'sci');
  store.set('rechner.mode', m);
}
$('btn-angle').addEventListener('click', () => { degrees = !degrees; store.set('rechner.deg', degrees); renderAngle(); render(); });

$('display').addEventListener('click', (e) => {
  if (e.target.closest('button')) return;
  const text = done ? lastResultText : ($('result').textContent.replace(/^= /, '') || expr);
  if (!text) return;
  navigator.clipboard?.writeText(text).then(() => toast('Kopiert: ' + text), () => {});
});

const KEYMAP = { '*': '×', x: '×', '/': '÷', ':': '÷', '-': '−', '.': ',', Enter: '=', '=': '=', Backspace: '⌫', Escape: 'AC', Delete: 'AC', p: 'π' };
document.addEventListener('keydown', (e) => {
  if (!$('view-calc').classList.contains('active') || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.target.closest('input, select, textarea')) return;
  const k = KEYMAP[e.key] || e.key;
  if (/^[0-9]$/.test(k) || ['+', '−', '×', '÷', '^', '%', '!', '(', ')', ',', '=', '⌫', 'AC', 'π', 'e'].includes(k)) {
    e.preventDefault();
    press(k);
    const btn = document.querySelector(`.k[data-k="${CSS.escape(k)}"]`);
    if (btn) { btn.classList.add('pressed'); setTimeout(() => btn.classList.remove('pressed'), 100); }
  }
});

// ───────────────────────── Verlauf ─────────────────────────
let history = store.get('rechner.history', []);

function addHistory(ex, result) {
  const item = { expr: ex, result, created: Date.now() };
  history.unshift(item);
  history = history.slice(0, 200);
  if (user) api('/api/history', { method: 'POST', body: item }).catch(() => {});
  else store.set('rechner.history', history);
  renderHistory();
}

function renderHistory() {
  const ul = $('history-list');
  ul.innerHTML = '';
  $('history-where').textContent = user ? 'in deinem Konto' : 'auf diesem Gerät';
  if (!history.length) { ul.innerHTML = '<li class="empty">Noch keine Rechnungen.</li>'; return; }
  for (const h of history) {
    const li = document.createElement('li');
    const a = document.createElement('div'); a.className = 'h-expr'; a.textContent = h.expr + ' =';
    const b = document.createElement('div'); b.className = 'h-res'; b.textContent = h.result;
    li.append(a, b);
    li.addEventListener('click', () => { expr = h.expr; done = false; $('history-sheet').hidden = true; render(); });
    ul.appendChild(li);
  }
}

$('btn-history').addEventListener('click', (e) => { e.stopPropagation(); renderHistory(); $('history-sheet').hidden = false; });
$('btn-history-close').addEventListener('click', () => { $('history-sheet').hidden = true; });
$('btn-history-clear').addEventListener('click', async () => {
  if (!history.length || !confirm('Verlauf wirklich leeren?')) return;
  if (user) { try { await api('/api/history', { method: 'DELETE' }); } catch (e) { return toast(e.message); } }
  history = []; store.set('rechner.history', history); renderHistory();
});

async function loadServerHistory() {
  try {
    // Rechnungen, die vor der Anmeldung auf diesem Gerät entstanden sind, ins Konto übernehmen
    const local = store.get('rechner.history', []);
    if (local.length) {
      await api('/api/history', { method: 'POST', body: { items: local.slice(0, 50).reverse() } });
      store.set('rechner.history', []);
    }
    const r = await api('/api/history');
    history = r.history;
    renderHistory();
  } catch {}
}

// ───────────────────────── Konto ─────────────────────────
async function auth(kind) {
  const name = $('auth-name').value.trim(), password = $('auth-pass').value;
  $('auth-error').textContent = '';
  try {
    const r = await api('/api/' + kind, { method: 'POST', body: { name, password } });
    token = r.token; store.set('rechner.token', token);
    setUser(r.user);
    $('auth-pass').value = '';
    toast(kind === 'register' ? 'Willkommen, ' + r.user.name + '!' : 'Angemeldet als ' + r.user.name);
    loadServerHistory();
  } catch (e) { $('auth-error').textContent = e.message; }
}
$('auth-form').addEventListener('submit', (e) => { e.preventDefault(); auth('login'); });
$('btn-register').addEventListener('click', () => {
  if (!$('auth-form').reportValidity()) return;
  auth('register');
});

function setUser(u) {
  user = u;
  $('acc-out').hidden = !!u; $('acc-in').hidden = !u;
  $('tab-account').textContent = u ? u.name : 'Konto';
  if (u) {
    $('acc-title').textContent = 'Hallo, ' + u.name;
    const s = [[u.calcs, 'Rechnungen gespeichert'], [u.duelsPlayed, 'Duelle gespielt'], [u.duelsWon, 'Duelle gewonnen'], [u.totalCorrect, 'Aufgaben zuerst gelöst']];
    $('acc-stats').innerHTML = '';
    for (const [v, l] of s) { const d = document.createElement('div'); d.className = 'stat'; d.innerHTML = '<b></b><span></span>'; d.firstChild.textContent = v; d.lastChild.textContent = l; $('acc-stats').appendChild(d); }
    if (!$('duel-name').value) $('duel-name').value = u.name;
  }
  renderHistory();
}

async function loadMe() {
  try { const r = await api('/api/me'); setUser(r.user); }
  catch (e) { if (e.status === 401) logoutLocal(); }
}
function logoutLocal() {
  token = ''; store.del('rechner.token'); history = store.get('rechner.history', []); setUser(null);
}
$('btn-logout').addEventListener('click', async () => { try { await api('/api/logout', { method: 'POST' }); } catch {} logoutLocal(); toast('Abgemeldet'); });
$('btn-delete').addEventListener('click', async () => {
  $('del-error').textContent = '';
  try {
    await api('/api/account/delete', { method: 'POST', body: { password: $('del-pass').value } });
    $('del-pass').value = ''; logoutLocal(); toast('Konto gelöscht');
  } catch (e) { $('del-error').textContent = e.message; }
});

// ───────────────────────── Rangliste ─────────────────────────
async function loadBoard() {
  const tb = $('board-body');
  try {
    const { leaders } = await api('/api/leaderboard');
    tb.innerHTML = '';
    if (!leaders.length) { tb.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center">Noch keine Duelle gespielt.</td></tr>'; return; }
    leaders.forEach((l, i) => {
      const tr = document.createElement('tr');
      for (const v of [i + 1, l.name, l.won, l.played, l.correct]) { const td = document.createElement('td'); td.textContent = v; tr.appendChild(td); }
      tb.appendChild(tr);
    });
  } catch { tb.innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center">Rangliste nicht erreichbar.</td></tr>'; }
}

// ───────────────────────── Rechen-Duell ─────────────────────────
let ws = null, me = null, players = [], roomCode = '';

function randomCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => abc[b % abc.length]).join('');
}

function joinRoom(code) {
  code = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length < 4) { $('duel-error').textContent = 'Der Code hat 4 Zeichen.'; return; }
  $('duel-error').textContent = '';
  leaveRoom(true);
  roomCode = code;
  const name = $('duel-name').value.trim() || 'Gast';
  store.set('rechner.duelName', name);
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?room=${code}`);
  const sock = ws;
  ws.onopen = () => sock.send(JSON.stringify({ type: 'hello', name, token }));
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; } onDuel(m); };
  ws.onclose = () => {
    if (ws !== sock) return;
    ws = null;
    if (!$('duel-room').hidden) { toast('Verbindung getrennt'); showDuelStart(); }
  };
}

function leaveRoom(silent) {
  if (ws) { const s = ws; ws = null; s.close(); }
  me = null; players = [];
  if (!silent) showDuelStart();
  window.history.replaceState(null, '', location.pathname);
}

function showDuelStart() { $('duel-start').hidden = false; $('duel-room').hidden = true; }

function renderPlayers(list) {
  players = list;
  const ul = $('players'); ul.innerHTML = '';
  for (const p of list) {
    const li = document.createElement('li');
    if (p.id === me) li.className = 'me';
    const n = document.createElement('span'); n.className = 'pname'; n.textContent = p.name + (p.id === me ? ' (du)' : '');
    li.appendChild(n);
    if (p.host) { const b = document.createElement('span'); b.className = 'badge'; b.textContent = 'Gastgeber'; li.appendChild(b); }
    const s = document.createElement('span'); s.className = 'score'; s.textContent = p.score; li.appendChild(s);
    ul.appendChild(li);
  }
  const host = list.find((p) => p.host);
  const iAmHost = host && host.id === me;
  $('host-controls').hidden = !iAmHost;
  $('wait-host').hidden = iAmHost;
}

function onDuel(m) {
  if (m.type === 'error') { $('duel-error').textContent = m.msg; toast(m.msg); return; }
  if (m.type === 'welcome') {
    me = m.you;
    $('duel-start').hidden = true; $('duel-room').hidden = false;
    $('room-code').textContent = m.room;
    $('duel-final').innerHTML = '';
    window.history.replaceState(null, '', '?raum=' + m.room);
    return;
  }
  if (m.type === 'lobby') {
    renderPlayers(m.players);
    const playing = m.state === 'playing';
    $('duel-lobby').hidden = playing; $('duel-play').hidden = !playing;
    if (playing) $('duel-final').innerHTML = '';
    return;
  }
  if (m.type === 'task') {
    $('duel-lobby').hidden = true; $('duel-play').hidden = false;
    $('task-n').textContent = `Aufgabe ${m.n} von ${m.total}`;
    $('task-text').textContent = m.text + ' = ?';
    $('feedback').textContent = ''; $('feedback').className = 'feedback';
    const a = $('answer'); a.value = ''; a.disabled = false; a.focus();
    const bar = $('timebar');
    bar.style.transition = 'none'; bar.style.transform = 'scaleX(1)'; void bar.offsetWidth;
    bar.style.transition = `transform ${m.ms}ms linear`; bar.style.transform = 'scaleX(0)';
    return;
  }
  if (m.type === 'wrong') {
    const f = $('feedback'); f.textContent = 'Leider falsch – nochmal!'; f.className = 'feedback bad';
    const a = $('answer'); a.classList.remove('shake'); void a.offsetWidth; a.classList.add('shake'); a.select();
    return;
  }
  if (m.type === 'round') {
    renderPlayers(m.players);
    $('answer').disabled = true;
    const f = $('feedback');
    const bar = $('timebar'); bar.style.transition = 'none';
    if (!m.winner) { f.textContent = `Zeit um! Lösung: ${m.answer}`; f.className = 'feedback bad'; }
    else if (m.winner.id === me) { f.textContent = `Richtig! +1 Punkt`; f.className = 'feedback good'; }
    else { f.textContent = `${m.winner.name} war schneller. Lösung: ${m.answer}`; f.className = 'feedback'; }
    return;
  }
  if (m.type === 'end') {
    const div = $('duel-final'); div.innerHTML = ''; div.className = 'final';
    const h = document.createElement('h3');
    const winners = m.ranking.filter((r) => m.winners.includes(r.id));
    h.textContent = !winners.length ? 'Unentschieden – niemand hat gepunktet.'
      : winners.length > 1 ? 'Gleichstand: ' + winners.map((w) => w.name).join(' & ')
      : (winners[0].id === me ? '🏆 Du hast gewonnen!' : '🏆 ' + winners[0].name + ' gewinnt!');
    const ol = document.createElement('ol');
    for (const r of m.ranking) { const li = document.createElement('li'); li.textContent = `${r.name}: ${r.score}`; ol.appendChild(li); }
    div.append(h, ol);
    if (user) loadMe();
  }
}

$('btn-create').addEventListener('click', () => joinRoom(randomCode()));
$('btn-join').addEventListener('click', () => joinRoom($('duel-code').value));
$('duel-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoom($('duel-code').value); });
$('btn-leave').addEventListener('click', () => leaveRoom(false));
$('btn-start').addEventListener('click', () => ws && ws.send(JSON.stringify({ type: 'start', rounds: Number($('duel-rounds').value) })));
$('answer-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('answer').value.trim();
  if (v && ws) ws.send(JSON.stringify({ type: 'answer', value: v }));
});
$('btn-share').addEventListener('click', async () => {
  const link = `${location.origin}/?raum=${roomCode}`;
  if (navigator.share) { try { await navigator.share({ title: 'Rechen-Duell', text: `Komm in meinen Raum ${roomCode}!`, url: link }); return; } catch {} }
  navigator.clipboard?.writeText(link).then(() => toast('Einladungslink kopiert'), () => toast(link));
});

// ───────────────────────── Start ─────────────────────────
setMode(store.get('rechner.mode', 'std'));
renderAngle();
renderSecond();
render();
$('duel-name').value = store.get('rechner.duelName', '');
if (token) loadMe().then(() => { if (user) loadServerHistory(); });
else setUser(null);
const invite = new URLSearchParams(location.search).get('raum');
if (invite) { showView('duel'); $('duel-code').value = invite.toUpperCase(); }
