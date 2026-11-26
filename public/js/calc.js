// Rechenkern: sicherer Parser für Ausdrücke (kein eval). Läuft im Browser und in Node (Tests, Server).
// Unterstützt: + − × ÷ ^ %, Klammern, Vorzeichen, Fakultät !, implizite Multiplikation (2π, 3(4+1)),
// Funktionen sin cos tan asin acos atan sinh cosh tanh ln log sqrt cbrt abs exp, Konstanten π e.

const FUNCS = {
  sin: (x, d) => Math.sin(d ? x * Math.PI / 180 : x),
  cos: (x, d) => Math.cos(d ? x * Math.PI / 180 : x),
  tan: (x, d) => {
    if (d && Math.abs(((x % 180) + 180) % 180 - 90) < 1e-12) throw new CalcError('Nicht definiert');
    return Math.tan(d ? x * Math.PI / 180 : x);
  },
  asin: (x, d) => { const r = Math.asin(x); return d ? r * 180 / Math.PI : r; },
  acos: (x, d) => { const r = Math.acos(x); return d ? r * 180 / Math.PI : r; },
  atan: (x, d) => { const r = Math.atan(x); return d ? r * 180 / Math.PI : r; },
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  ln: (x) => { if (x <= 0) throw new CalcError('Nicht definiert'); return Math.log(x); },
  log: (x) => { if (x <= 0) throw new CalcError('Nicht definiert'); return Math.log10(x); },
  sqrt: (x) => { if (x < 0) throw new CalcError('Nicht definiert'); return Math.sqrt(x); },
  cbrt: Math.cbrt, abs: Math.abs, exp: Math.exp,
};
const CONSTS = { 'π': Math.PI, pi: Math.PI, e: Math.E };

export class CalcError extends Error {}

// Gibt Tokens zurück: {t:'num',v} {t:'op',v} {t:'fn',v} {t:'(' } {t:')'} {t:'!'} {t:'%'}
export function tokenize(src) {
  const s = String(src)
    .replace(/×|\*/g, '*').replace(/÷|\//g, '/').replace(/−|–/g, '-')
    .replace(/√/g, 'sqrt').replace(/∛/g, 'cbrt').replace(/,/g, '.').replace(/\s+/g, '');
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      // wissenschaftliche Schreibweise 1.5E10 / 2E-3
      if (s[j] === 'E' && /[0-9+-]/.test(s[j + 1] || '')) {
        j++; if (s[j] === '+' || s[j] === '-') j++;
        while (j < s.length && /[0-9]/.test(s[j])) j++;
      }
      const txt = s.slice(i, j);
      if ((txt.match(/\./g) || []).length > 1 || txt === '.') throw new CalcError('Ungültige Zahl');
      out.push({ t: 'num', v: parseFloat(txt) });
      i = j; continue;
    }
    if (/[a-zπ]/i.test(c)) {
      let j = i;
      while (j < s.length && /[a-zπ]/i.test(s[j])) j++;
      let word = s.slice(i, j).toLowerCase();
      // Wort zerlegen: längste bekannte Funktion/Konstante zuerst (z. B. "2πe" oder "sinpi")
      while (word.length) {
        const names = [...Object.keys(FUNCS), ...Object.keys(CONSTS)].sort((a, b) => b.length - a.length);
        const hit = names.find((n) => word.startsWith(n));
        if (!hit) throw new CalcError('Unbekannt: ' + word);
        out.push(hit in FUNCS ? { t: 'fn', v: hit } : { t: 'num', v: CONSTS[hit] });
        word = word.slice(hit.length);
      }
      i = j; continue;
    }
    if ('+-*/^'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    if (c === '(' || c === ')' || c === '!' || c === '%') { out.push({ t: c }); i++; continue; }
    if (c === '²' || c === '³') { out.push({ t: 'pow', v: c === '²' ? 2 : 3 }); i++; continue; }
    throw new CalcError('Ungültiges Zeichen: ' + c);
  }
  return out;
}

// Rekursiver Abstieg:
// expr   := term (('+'|'-') term)*
// term   := unary (('*'|'/') unary | implizit unary)*
// unary  := ('+'|'-') unary | power
// power  := postfix ('^' unary)?        (rechtsassoziativ, -2^2 = -4)
// postfix:= primary ('!' | '%' | '²' | '³')*
// primary:= num | fn primary | '(' expr ')'
export function evaluate(src, { degrees = false } = {}) {
  const tk = tokenize(src);
  if (!tk.length) throw new CalcError('Leer');
  let p = 0;
  const peek = () => tk[p];
  const isOp = (v) => peek() && peek().t === 'op' && peek().v === v;
  const startsPrimary = (x) => x && (x.t === 'num' || x.t === 'fn' || x.t === '(');

  function expr() {
    let v = term();
    while (isOp('+') || isOp('-')) {
      const op = tk[p++].v; const r = term();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function term() {
    let v = unary();
    for (;;) {
      if (isOp('*')) { p++; v *= unary(); }
      else if (isOp('/')) { p++; const r = unary(); if (r === 0) throw new CalcError('Division durch 0'); v /= r; }
      else if (startsPrimary(peek())) v *= power();
      else return v;
    }
  }
  function unary() {
    if (isOp('-')) { p++; return -unary(); }
    if (isOp('+')) { p++; return unary(); }
    return power();
  }
  function power() {
    const b = postfix();
    if (isOp('^')) { p++; const e = unary(); const r = Math.pow(b, e); if (Number.isNaN(r)) throw new CalcError('Nicht definiert'); return r; }
    return b;
  }
  function postfix() {
    let v = primary();
    while (peek() && (peek().t === '!' || peek().t === '%' || peek().t === 'pow')) {
      const x = tk[p++];
      if (x.t === '!') v = factorial(v); else if (x.t === 'pow') v = Math.pow(v, x.v); else v = v / 100;
    }
    return v;
  }
  function primary() {
    const x = tk[p];
    if (!x) throw new CalcError('Unvollständig');
    if (x.t === 'num') { p++; return x.v; }
    if (x.t === 'fn') {
      p++;
      const arg = peek() && peek().t === '(' ? primary() : power();
      const r = FUNCS[x.v](arg, degrees);
      if (Number.isNaN(r)) throw new CalcError('Nicht definiert');
      return r;
    }
    if (x.t === '(') {
      p++;
      const v = expr();
      if (peek() && peek().t === ')') p++; // fehlende schließende Klammern am Ende sind erlaubt
      else if (peek()) throw new CalcError('Klammer fehlt');
      return v;
    }
    throw new CalcError('Syntaxfehler');
  }
  const v = expr();
  if (p < tk.length) throw new CalcError('Syntaxfehler');
  if (!Number.isFinite(v)) throw new CalcError(Number.isNaN(v) ? 'Nicht definiert' : 'Überlauf');
  return v;
}

function factorial(n) {
  if (n < 0 || !Number.isInteger(n)) throw new CalcError('Fakultät nur für ganze Zahlen ≥ 0');
  if (n > 170) throw new CalcError('Überlauf');
  let r = 1; for (let i = 2; i <= n; i++) r *= i; return r;
}

// Zahl hübsch und ohne Rundungsfehler (0,1+0,2 = 0,3) mit deutschem Komma ausgeben.
export function format(v, { comma = true } = {}) {
  if (!Number.isFinite(v)) return 'Fehler';
  if (Object.is(v, -0)) v = 0;
  let s;
  const a = Math.abs(v);
  if (a !== 0 && (a >= 1e15 || a < 1e-9)) {
    s = v.toExponential(10).replace(/\.?0+e/, 'e').replace('e+', 'E').replace('e-', 'E-');
  } else {
    s = String(parseFloat(v.toPrecision(12)));
    if (/e/.test(s)) s = v.toExponential(10).replace(/\.?0+e/, 'e').replace('e+', 'E').replace('e-', 'E-');
  }
  if (!comma) return s;
  // Tausenderpunkte im ganzzahligen Teil, Komma als Dezimaltrenner
  const [int, frac] = s.split('.');
  if (/E/.test(s)) return s.replace('.', ',');
  const neg = int.startsWith('-');
  const digits = neg ? int.slice(1) : int;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-' : '') + grouped + (frac ? ',' + frac : '');
}

// Ergebnis-Text oder Fehlertext – bequem für die Oberfläche.
export function calc(src, opts) {
  try { return { ok: true, value: evaluate(src, opts) }; }
  catch (e) { return { ok: false, error: e instanceof CalcError ? e.message : 'Fehler' }; }
}
