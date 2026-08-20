import { expect, test } from 'vitest'

import { obfuscateWithTransformPipeline as obfuscate } from './obfuscator-helpers'

function evalProgram(code: string, harness?: Record<string, unknown>): unknown {
  const keys = harness ? Object.keys(harness) : []
  const values = harness ? keys.map((k) => harness[k]) : []
  return new Function(...keys, code).call(null, ...values)
}

test('obfuscate is pure: same input produces same output across calls', () => {
  const src = `function add(a, b) { return a + b; }
var v = add(1, 2);
log(v);`
  const a = obfuscate(src)
  const b = obfuscate(src)
  expect(a).toBe(b)
})

test('obfuscate accepts options without altering equivalence', () => {
  const src = `var x = 1 + 2; log(x);`
  expect(obfuscate(src)).toBe(obfuscate(src, {}))
})

test('obfuscate preserves a license-bang block comment', () => {
  const out = obfuscate(`/*! (c) 2025 Acme Corp. All rights reserved. */
log('hi');`)
  expect(out).toContain('(c) 2025 Acme Corp')
})

test('obfuscate preserves a comment containing @license', () => {
  const out = obfuscate(`/** @license MIT */
log('hi');`)
  expect(out).toContain('@license')
})

test('obfuscate preserves a comment containing @preserve', () => {
  const out = obfuscate(`/** @preserve fingerprint */
log('hi');`)
  expect(out).toContain('@preserve')
})

test('obfuscate preserves comments attached to mangled property expressions', () => {
  const out = obfuscate(
    `var object = { /*! key-license */ secret_: read() };
expose(object);
log(object./*! member-license */secret_, object[/*! computed-license */ \`secret_\`]);`,
    {
      transforms: {
        mangleProperties: {
          builtins: true,
          nameGenerator: () => 'renamed',
        },
      },
    },
  )
  expect(out).toContain('key-license')
  expect(out).toContain('member-license')
  expect(out).toContain('computed-license')
})

test('obfuscate preserves the //# sourceMappingURL directive', () => {
  const out = obfuscate(`log('hi');
//# sourceMappingURL=app.js.map`)
  expect(out).toContain('//# sourceMappingURL=app.js.map')
})

test('obfuscate preserves the //# sourceURL directive', () => {
  const out = obfuscate(`log('hi');
//# sourceURL=app.js`)
  expect(out).toContain('//# sourceURL=app.js')
})

test('obfuscate drops every other comment', () => {
  const out = obfuscate(`// regular
/* also regular */
/** @internal */
log('hi');`)
  expect(out).not.toContain('regular')
  expect(out).not.toContain('@internal')
})

test('obfuscate keeps a "use strict" directive present in the input', () => {
  const out = obfuscate(`'use strict';
log('hi');`)
  expect(out).toMatch(/^['"]use strict['"]/m)
})

test('obfuscate does not introduce "use strict" when input lacks one', () => {
  const out = obfuscate(`log('hi');`)
  expect(out).not.toMatch(/['"]use strict['"]/)
})

test('obfuscate propagates parse errors instead of swallowing them', () => {
  expect(() => obfuscate(`var = ;`)).toThrow()
})

test('obfuscate of arithmetic preserves observable result', () => {
  const out = obfuscate(`var x = 1 + 2 * 3 - 4; var y = x % 3; var z = x ** 2;
log(x); log(y); log(z);`)
  const calls: unknown[] = []
  evalProgram(out, { log: (v: unknown) => calls.push(v) })
  expect(calls).toEqual([3, 0, 9])
})

test('obfuscate of a recursive factorial preserves observable result', () => {
  const out = obfuscate(`function fact(n) {
  return n <= 1 ? 1 : n * fact(n - 1);
}
log(fact(6));`)
  const calls: unknown[] = []
  evalProgram(out, { log: (v: unknown) => calls.push(v) })
  expect(calls).toEqual([720])
})

test('obfuscate of a closure-counter preserves observable result', () => {
  const out = obfuscate(`function makeCounter() {
  var n = 0;
  return function () {
    n = n + 1;
    return n;
  };
}
var c = makeCounter();
log(c()); log(c()); log(c());`)
  const calls: unknown[] = []
  evalProgram(out, { log: (v: unknown) => calls.push(v) })
  expect(calls).toEqual([1, 2, 3])
})

test('obfuscate of an early-return function preserves both branches', () => {
  const out = obfuscate(`function pick(x) {
  if (x > 0) return 'pos';
  if (x < 0) return 'neg';
  return 'zero';
}
log(pick(5)); log(pick(-3)); log(pick(0));`)
  const calls: unknown[] = []
  evalProgram(out, { log: (v: unknown) => calls.push(v) })
  expect(calls).toEqual(['pos', 'neg', 'zero'])
})

test('obfuscate of switch with fallthrough and default-not-last preserves dispatch', () => {
  const out = obfuscate(`function classify(x) {
  var s = '';
  switch (x) {
    case 1: s += 'a';
    case 2: s += 'b'; break;
    default: s += 'd'; break;
    case 3: s += 'c'; break;
  }
  return s;
}
log(classify(1));
log(classify(2));
log(classify(3));
log(classify(99));`)
  const calls: unknown[] = []
  evalProgram(out, { log: (v: unknown) => calls.push(v) })
  expect(calls).toEqual(['ab', 'b', 'c', 'd'])
})

test('obfuscate of a for loop with continue preserves loop semantics', () => {
  const out = obfuscate(`var total = 0;
for (var i = 0; i < 10; i++) {
  if (i % 2 === 0) continue;
  total = total + i;
}
log(total);`)
  const calls: unknown[] = []
  evalProgram(out, { log: (v: unknown) => calls.push(v) })
  expect(calls).toEqual([1 + 3 + 5 + 7 + 9])
})

test('obfuscate of a labeled break across nested loops preserves control flow', () => {
  const out = obfuscate(`var pairs = [];
outer: for (var i = 0; i < 3; i++) {
  for (var j = 0; j < 3; j++) {
    if (i === 1 && j === 1) break outer;
    pairs.push([i, j]);
  }
}
log(pairs);`)
  const calls: unknown[] = []
  evalProgram(out, { log: (v: unknown) => calls.push(v) })
  expect(calls).toEqual([
    [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
    ],
  ])
})

test('obfuscate of optional chaining preserves null short-circuit', () => {
  const out = obfuscate(`function getX(o) {
  return o?.a?.b;
}
log(getX({ a: { b: 7 } }));
log(getX({ a: null }));
log(getX(null));`)
  const calls: unknown[] = []
  evalProgram(out, { log: (v: unknown) => calls.push(v) })
  expect(calls).toEqual([7, undefined, undefined])
})

test('obfuscate of an optional call preserves the receiver this-binding', () => {
  const out = obfuscate(`var calls = 0;
var obj = {
  v: 7,
  m: function () { calls++; return this.v; }
};
log(obj?.m());
log(calls);`)
  const observed: unknown[] = []
  evalProgram(out, { log: (v: unknown) => observed.push(v) })
  expect(observed).toEqual([7, 1])
})

test('obfuscate of an optional chain with side-effectful receiver evaluates once when nullish', () => {
  const out = obfuscate(`var calls = 0;
function get() { calls++; return null; }
log(get()?.foo?.bar);
log(calls);`)
  const observed: unknown[] = []
  evalProgram(out, { log: (v: unknown) => observed.push(v) })
  expect(observed).toEqual([undefined, 1])
})

test('obfuscate of logical-assignment with side-effectful object and key caches both', () => {
  const out = obfuscate(`var objCalls = 0, keyCalls = 0;
var obj = { ks: ['x'] };
function recv() { objCalls++; return obj.ks; }
function k() { keyCalls++; return 0; }
recv()[k()] ||= 'default';
log(obj.ks);
log(objCalls);
log(keyCalls);`)
  const observed: unknown[] = []
  evalProgram(out, { log: (v: unknown) => observed.push(v) })
  expect(observed).toEqual([['x'], 1, 1])
})

test('obfuscate of nullish coalescing preserves null/undefined-only fallback', () => {
  const out = obfuscate(`function fb(x) {
  return x ?? 'default';
}
log(fb(null));
log(fb(undefined));
log(fb(0));
log(fb(''));`)
  const calls: unknown[] = []
  evalProgram(out, { log: (v: unknown) => calls.push(v) })
  expect(calls).toEqual(['default', 'default', 0, ''])
})

test('obfuscate of logical assignment preserves single-evaluation semantics', () => {
  const out = obfuscate(`var sideEffects = 0;
function recv() { sideEffects++; return obj; }
var obj = { x: null };
recv().x ??= 42;
log(obj.x);
log(sideEffects);`)
  const calls: unknown[] = []
  evalProgram(out, { log: (v: unknown) => calls.push(v) })
  expect(calls).toEqual([42, 1])
})

test('obfuscate of a closure-capturing loop preserves per-iteration captures', () => {
  const out = obfuscate(`var fns = [];
for (let i = 0; i < 3; i++) {
  fns.push(function () { return i; });
}
log(fns[0]());
log(fns[1]());
log(fns[2]());`)
  const calls: unknown[] = []
  evalProgram(out, { log: (v: unknown) => calls.push(v) })
  expect(calls).toEqual([0, 1, 2])
})

test('obfuscate of a side-effectful argument evaluates it once', () => {
  const out = obfuscate(`function f(x) { return x + x; }
var calls = 0;
function side() { calls++; return 5; }
log(f(side()));
log(calls);`)
  const observed: unknown[] = []
  evalProgram(out, { log: (v: unknown) => observed.push(v) })
  expect(observed).toEqual([10, 1])
})

test('obfuscate of a try/catch/finally preserves completion order', () => {
  const out = obfuscate(`var trace = [];
function run() {
  try {
    trace.push('try');
    throw new Error('boom');
  } catch (e) {
    trace.push('catch:' + e.message);
  } finally {
    trace.push('finally');
  }
  return trace;
}
log(run());`)
  const observed: unknown[] = []
  evalProgram(out, { log: (v: unknown) => observed.push(v) })
  expect(observed).toEqual([['try', 'catch:boom', 'finally']])
})

test('obfuscate of an arrow with this-capture preserves the captured receiver', () => {
  const out = obfuscate(`function Outer(x) { this.x = x; }
Outer.prototype.run = function () {
  var self = this;
  var arrow = () => self.x;
  return arrow();
};
log(new Outer(42).run());`)
  const observed: unknown[] = []
  evalProgram(out, { log: (v: unknown) => observed.push(v) })
  expect(observed).toEqual([42])
})

test('obfuscate is stable on a small real-world snippet (event-emitter shape)', () => {
  const out = obfuscate(`function EE() { this.h = {}; }
EE.prototype.on = function (e, cb) {
  (this.h[e] || (this.h[e] = [])).push(cb);
  return this;
};
EE.prototype.emit = function (e) {
  var args = [];
  for (var i = 1; i < arguments.length; i++) args.push(arguments[i]);
  var hs = this.h[e] || [];
  for (var j = 0; j < hs.length; j++) hs[j].apply(null, args);
};
var ee = new EE();
var trace = [];
ee.on('x', function (v) { trace.push('a:' + v); });
ee.on('x', function (v) { trace.push('b:' + v); });
ee.emit('x', 1);
ee.emit('x', 2);
log(trace);`)
  const observed: unknown[] = []
  evalProgram(out, { log: (v: unknown) => observed.push(v) })
  expect(observed).toEqual([['a:1', 'b:1', 'a:2', 'b:2']])
})

test('obfuscate of a derived class with instance fields synthesizes a forwarding super constructor', () => {
  const out = obfuscate(`class Base {
  constructor(x) { this.x = x; }
}
class Derived extends Base {
  y = 99;
}
log(new Derived(7).x);
log(new Derived(7).y);`)
  const observed: unknown[] = []
  evalProgram(out, { log: (v: unknown) => observed.push(v) })
  expect(observed).toEqual([7, 99])
})

test('obfuscate of a destructure-default does not double-evaluate a getter', () => {
  const out = obfuscate(`var reads = 0;
var obj = Object.defineProperty({}, 'a', {
  get: function () { reads++; return undefined; },
});
var { a = 7 } = obj;
log(a);
log(reads);`)
  const observed: unknown[] = []
  evalProgram(out, { log: (v: unknown) => observed.push(v) })
  expect(observed).toEqual([7, 1])
})

test('obfuscate of a switch case containing a function declaration keeps it visible across cases', () => {
  const out = obfuscate(`function go(x) {
  switch (x) {
    case 1:
      function helper(n) { return n * 10; }
      return helper(x);
    case 2:
      return helper(x);
  }
  return -1;
}
log(go(1));
log(go(2));
log(go(3));`)
  const observed: unknown[] = []
  evalProgram(out, { log: (v: unknown) => observed.push(v) })
  expect(observed).toEqual([10, 20, -1])
})

test('obfuscate of an inline candidate whose body reads this through a nested arrow does not inline', () => {
  const out = obfuscate(`function f() {
  return (function () { return (() => this.x)(); }).call({ x: 'inner' });
}
log(f());`)
  const observed: unknown[] = []
  evalProgram(out, { log: (v: unknown) => observed.push(v) })
  expect(observed).toEqual(['inner'])
})

test('obfuscate handles a deeply nested binary expression without overflowing our walks', () => {
  let src = '0'
  for (let i = 0; i < 1000; i++) {
    src = `(${src} + 1)`
  }
  const code = `log(${src});`
  const out = obfuscate(code)
  const observed: unknown[] = []
  evalProgram(out, { log: (v: unknown) => observed.push(v) })
  expect(observed).toEqual([1000])
})

test('obfuscate converges on inlined-body wrapper extraction without an iteration cap', () => {
  const out = obfuscate(`function makeWrapper() {
  var u = { f: function () { return 5; } };
  return u.f();
}
log(makeWrapper());`)
  const observed: unknown[] = []
  evalProgram(out, { log: (v: unknown) => observed.push(v) })
  expect(observed).toEqual([5])
})

test('obfuscate converges on a chain of N inlines that each surface a wrapper', () => {
  const N = 8
  const fns: string[] = []
  for (let i = 0; i < N; i++) {
    const next = i === N - 1 ? '5' : `f${i + 1}()`
    fns.push(`function f${i}() {
  var w${i} = { v: ${next} };
  return w${i}.v;
}`)
  }
  const src = `${fns.join('\n')}\nlog(f0());`
  const out = obfuscate(src)
  const observed: unknown[] = []
  evalProgram(out, { log: (v: unknown) => observed.push(v) })
  expect(observed).toEqual([5])
})

test('obfuscate converges on a deeply-nested constant-fold chain', () => {
  let src = '0'
  for (let i = 0; i < 50; i++) {
    src = `((${src} + 1) + 1)`
  }
  const out = obfuscate(`var x = ${src}; log(x);`)
  const observed: unknown[] = []
  evalProgram(out, { log: (v: unknown) => observed.push(v) })
  expect(observed).toEqual([100])
})
