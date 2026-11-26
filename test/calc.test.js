import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, format, calc } from '../public/js/calc.js';

const ev = (s, o) => format(evaluate(s, o));

test('Grundrechenarten und Punkt vor Strich', () => {
  assert.equal(ev('2+3×4'), '14');
  assert.equal(ev('(2+3)×4'), '20');
  assert.equal(ev('10÷4'), '2,5');
  assert.equal(ev('7−10'), '-3');
  assert.equal(ev('2*3/4'), '1,5');
});

test('keine Rundungsfehler bei Kommazahlen', () => {
  assert.equal(ev('0,1+0,2'), '0,3');
  assert.equal(ev('1,1×3'), '3,3');
  assert.equal(ev('0,3−0,1'), '0,2');
});

test('Potenzen, Vorzeichen, Fakultät, Prozent', () => {
  assert.equal(ev('-2^2'), '-4');
  assert.equal(ev('2^3^2'), '512');
  assert.equal(ev('3×−2'), '-6');
  assert.equal(ev('5!'), '120');
  assert.equal(ev('50%×200'), '100');
  assert.equal(ev('2^-1'), '0,5');
  assert.equal(ev('2²^3'), '64');
  assert.equal(ev('-3²'), '-9');
  assert.equal(ev('2³+1'), '9');
});

test('Funktionen und Konstanten', () => {
  assert.equal(ev('sin(90)', { degrees: true }), '1');
  assert.equal(ev('cos(π)'), '-1');
  assert.equal(ev('asin(1)', { degrees: true }), '90');
  assert.equal(ev('√(16)+∛(27)'), '7');
  assert.equal(ev('ln(e)'), '1');
  assert.equal(ev('log(1000)'), '3');
  assert.equal(ev('2π'), '6,28318530718');
  assert.equal(ev('3(4+1)'), '15');
  assert.equal(ev('e^(0)'), '1');
  assert.equal(ev('10^(3)'), '1.000');
});

test('offene Klammern am Ende werden geschlossen', () => {
  assert.equal(ev('(1+2'), '3');
  assert.equal(ev('sin(30', { degrees: true }), '0,5');
});

test('Ausgabe: Tausenderpunkte und Exponent', () => {
  assert.equal(format(1234567.5), '1.234.567,5');
  assert.equal(format(-9876543), '-9.876.543');
  assert.equal(format(3e20), '3E20');
  assert.equal(format(1.5e-12), '1,5E-12');
  assert.equal(format(-0), '0');
  assert.equal(format(3e20, { comma: false }), '3E20');
  assert.equal(ev('3E20×2'), '6E20');
});

test('Fehler werden verständlich gemeldet', () => {
  assert.deepEqual(calc('1÷0'), { ok: false, error: 'Division durch 0' });
  assert.equal(calc('√(−1)').error, 'Nicht definiert');
  assert.equal(calc('tan(90)', { degrees: true }).error, 'Nicht definiert');
  assert.equal(calc('2,5!').ok, false);
  assert.equal(calc('1++').ok, false);
  assert.equal(calc('1,2,3').ok, false);
  assert.equal(calc('').ok, false);
  assert.equal(calc('alert(1)').ok, false);
  assert.equal(calc('171!').error, 'Überlauf');
});
