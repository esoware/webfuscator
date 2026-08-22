import { createHash } from 'node:crypto'

import type { File } from '@babel/types'
import { expect, test } from 'vitest'

import { obfuscate } from '../../src/index'
import { pack } from '../../src/transforms/pack'
import { defineCases, run } from '../helpers'
import { obfuscateWithTransformPipeline } from '../obfuscator-helpers'

const packMangled = (ast: File): void => {
  pack(ast, { seed: 0, stringGeneratorMode: 'mangled' })
}

// Preparation must run before pack, so behavior tests obfuscate with pack enabled
// rather than calling the transform in isolation.
const packOnly = (src: string): string => obfuscate(src, { transforms: { pack: true } })

interface Trace {
  logs: unknown[]
  threw: string | null
}

// Runs `code` with `log` and any named globals supplied as parameters, so the
// packed body's accessors resolve them from the surrounding scope exactly as a
// real deployment would resolve globals, imports, or host bindings.
function traceWith(code: string, globals: Record<string, unknown> = {}): Trace {
  const logs: unknown[] = []
  const log = (...args: unknown[]): void => {
    logs.push(args.length === 1 ? args[0] : args)
  }
  const names = Object.keys(globals)
  const values = names.map((name) => globals[name])
  try {
    // oxlint-disable-next-line no-new-func
    new Function('log', ...names, code)(log, ...values)
    return { logs, threw: null }
  } catch (error) {
    return { logs, threw: (error as Error).constructor.name }
  }
}

function expectEquivalent(src: string, globals: Record<string, unknown> = {}): string {
  const packed = packOnly(src)
  expect(traceWith(packed, globals)).toEqual(traceWith(src, globals))
  return packed
}

const cases = defineCases('pack', packMangled, {
  globalCall: {
    name: 'pack routes a global callee through an indirect member access',
    input: `alert(message);`,
  },
  methodReceiver: {
    name: 'pack keeps a method receiver by routing only the base global',
    input: `console.log(value);`,
  },
  assignment: {
    name: 'pack adds a setter for a written global',
    input: `counter = counter + 1;`,
  },
  typeofGlobal: {
    name: 'pack maps typeof of a bare global to its own accessor',
    input: `log(typeof maybeMissing);`,
  },
  keepsLocals: {
    name: 'pack leaves declared bindings inside the packed body',
    input: `function add(a, b) { return a + b; } send(add(2, 3));`,
  },
})

test('pack output is a Function constructor call', () => {
  const out = packOnly(`log("hi");`)
  expect(out.trimStart().startsWith('Function(')).toBe(true)
  expect(traceWith(out).logs).toEqual(['hi'])
})

test(cases.globalCall.name, () => {
  const calls: unknown[] = []
  expectEquivalent(cases.globalCall.input, {
    alert: (v: unknown) => calls.push(v),
    message: 'ping',
  })
})

test(cases.methodReceiver.name, () => {
  expectEquivalent(cases.methodReceiver.input, { value: 42 })
})

test('pack preserves the receiver of a bare global call (indirect this)', () => {
  // A member callee would rebind `this` to the accessor object. A sloppy bare
  // call coerces its undefined receiver to the global object, so the probe must
  // still see the global, not the object.
  // oxlint-disable-next-line no-new-func
  const probe = new Function('return this === globalThis')
  expectEquivalent(`log(probe());`, { probe })
})

test('pack roundtrips a global through its getter and setter', () => {
  expectEquivalent(`counter = counter + 1; counter = counter + 1; log(counter);`, { counter: 0 })
})

test('pack routes a compound assignment to the same accessor', () => {
  expectEquivalent(`total += 5; total *= 2; log(total);`, { total: 3 })
})

test('pack routes update expressions through the setter', () => {
  expectEquivalent(`tick++; ++tick; log(tick);`, { tick: 0 })
})

test('pack maps typeof of an undeclared global without throwing', () => {
  const out = packOnly(`log(typeof definitelyNotDeclared);`)
  expect(traceWith(out)).toEqual({ logs: ['undefined'], threw: null })
})

test('pack keeps typeof and value accesses of the same global separate', () => {
  expectEquivalent(`log(typeof shared); shared = shared + 1; log(typeof shared, shared);`, {
    shared: 10,
  })
})

test('pack preserves observable behavior of a self-contained program', () => {
  expectEquivalent(`function fib(n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
log(fib(10));`)
})

test('pack preserves try/catch and thrown error classes', () => {
  expectEquivalent(`try { null.x; } catch (e) { log(e.constructor.name); }
log("after");`)
})

test('pack preserves closures capturing local state', () => {
  expectEquivalent(`function make() { var n = 0; return function () { return ++n; }; }
var next = make();
log(next(), next(), next());`)
})

test('pack preserves a strict-mode undeclared-write throw', () => {
  const src = `"use strict";
var result;
try { neverDeclared = 1; result = "no throw"; } catch (e) { result = e.constructor.name; }
log(result);`
  expect(traceWith(packOnly(src))).toEqual({ logs: ['ReferenceError'], threw: null })
  // The original, run under the strict harness, throws the same way.
  expect(traceWith(src)).toEqual({ logs: ['ReferenceError'], threw: null })
})

test('pack escapeStrict drops the directive so the body runs sloppy', () => {
  const src = `"use strict";
var result;
try { escapedGlobal = 1; result = "no throw"; } catch (e) { result = e.constructor.name; }
log(result);`
  const escaped = obfuscate(src, { transforms: { pack: { escapeStrict: true } } })
  expect(escaped).not.toMatch(/use strict/u)
  try {
    // Sloppy mode creates the global instead of throwing.
    expect(traceWith(escaped)).toEqual({ logs: ['no throw'], threw: null })
  } finally {
    delete (globalThis as Record<string, unknown>)['escapedGlobal']
  }
})

test('pack escapeStrict is a no-op for code that is already sloppy', () => {
  const src = `function add(a, b) { return a + b; } log(add(2, 3));`
  const escaped = obfuscate(src, { transforms: { pack: { escapeStrict: true } } })
  expect(traceWith(escaped)).toEqual(traceWith(src))
})

test('pack keeps top-level this as the global object for a strict script', () => {
  const src = `"use strict"; globalThis.__packThisProbe = this === globalThis;`
  const packed = packOnly(src)
  expect(packed).toContain('.call(this,')
  try {
    // Indirect eval runs at global scope, where a strict script keeps `this`
    // bound to the global object.
    // oxlint-disable-next-line no-eval
    ;(0, eval)(packed)
    expect((globalThis as Record<string, unknown>)['__packThisProbe']).toBe(true)
  } finally {
    delete (globalThis as Record<string, unknown>)['__packThisProbe']
  }
})

test('pack hoists import declarations above the call and routes the binding', () => {
  const src = `import { createHash } from "node:crypto";
log(createHash("sha256").update("payload").digest("hex"));`
  const packed = obfuscate(src, { transforms: { pack: true } })
  expect(packed.trimStart().startsWith('import')).toBe(true)
  expect(packed).toContain('Function(')

  const logs: unknown[] = []
  // Drop the ES import and supply the binding directly; the accessor closes over
  // it just as it would over the real import at the module top level.
  const runnable = packed.replace(/import[^;]*;/u, '')
  // oxlint-disable-next-line no-new-func
  new Function('log', 'createHash', runnable)((v: unknown) => logs.push(v), createHash)
  expect(logs).toEqual([createHash('sha256').update('payload').digest('hex')])
})

test('pack preserves the completion value through an eval of the output', () => {
  const packed = packOnly(`3 * 4;`)
  // oxlint-disable-next-line no-eval
  expect((0, eval)(packed)).toBe(12)
})

test('pack composes with the full transform pipeline without changing behavior', () => {
  const src = `function classify(n) {
  switch (n % 3) {
    case 0: return "zero";
    case 1: return "one";
    default: return "other";
  }
}
var out = [];
for (var i = 0; i < 5; i++) { out.push(classify(i)); }
log(out.join(","));`
  const packed = obfuscateWithTransformPipeline(src, { transforms: { pack: true } })
  expect(traceWith(packed)).toEqual(traceWith(src))
})

test('pack is deterministic for a fixed seed', () => {
  const src = `log(compute(input));`
  expect(packOnly(src)).toBe(packOnly(src))
})

test('pack throws on an export statement', () => {
  // Export syntax cannot exist inside a Function body, so pack refuses it loudly
  // rather than emit output that fails to parse.
  expect(() => packOnly(`export const value = 1;`)).toThrow(/export/u)
})

test('pack wraps a with statement and routes only names outside it', () => {
  // Names inside `with` may resolve against the with object at runtime, so they
  // stay bare; only `log`, outside the with, is routed.
  const packed = expectEquivalent(`var out; with ({ x: 41 }) { out = x + 1; } log(out);`)
  expect(packed).toContain('Function(')
})

test('pack no longer bails on module-only constructs', () => {
  // These pack like anything else. A construct that cannot run inside a Function
  // body is the caller's to keep out of pack.
  expect(packOnly(`log(import.meta.url);`)).toContain('Function(')
  expect(packOnly(`const data = await fetchThing(); log(data);`)).toContain('Function(')
  expect(packOnly(`import("./mod.js").then(log);`)).toContain('Function(')
  expect(packOnly(`log(arguments.length);`)).toContain('Function(')
})

test('pack wraps a direct eval and leaves eval un-routed', () => {
  const packed = expectEquivalent(`log(eval("1 + 1"));`)
  expect(packed).toContain('Function(')
  expect(packed).toContain('eval(')
})

test('pack wraps an optional direct eval', () => {
  const packed = expectEquivalent(`log(eval?.("2 + 3"));`)
  expect(packed).toContain('Function(')
})

test('pack keeps a direct eval reading a local body binding', () => {
  expectEquivalent(`var n = 4; log(eval("n + 1"));`)
})

test('pack wraps a call to a local binding named eval', () => {
  // A local `eval` is an ordinary function, not the global. It has a binding, so
  // the router leaves it alone and pack wraps the program normally.
  expectEquivalent(`function eval(x) { return x + 1; } log(eval(41));`)
})

test('pack keeps a bare delete operating on the global binding', () => {
  // A routed `delete obj[prop]` would drop the accessor; the delete must stay
  // bare so it hits the real global, matching the original program.
  const src = `__packDeleteProbe = 5; var had = delete __packDeleteProbe; log(had, typeof __packDeleteProbe);`
  try {
    expect(traceWith(packOnly(src))).toEqual(traceWith(src))
  } finally {
    delete (globalThis as Record<string, unknown>)['__packDeleteProbe']
  }
})

test('pack reaches the real constructor when an import shadows Function', () => {
  const src = `import { Function } from "node:util";
log(1);`
  const packed = obfuscate(src, { transforms: { pack: true } })
  expect(packed.trimStart().startsWith('import')).toBe(true)
  // A function instance's constructor is the real Function regardless of the
  // shadowing import.
  expect(packed).toContain('.constructor(')

  const logs: unknown[] = []
  const runnable = packed.replace(/import[^;]*;/u, '')
  // oxlint-disable-next-line no-new-func
  new Function('log', runnable)((v: unknown) => logs.push(v))
  expect(logs).toEqual([1])
})

test('pack still wraps a program with no free identifiers', () => {
  const out = packOnly(`var x = 1; var y = x + 1;`)
  expect(out.trimStart().startsWith('Function(')).toBe(true)
  expect(traceWith(out)).toEqual({ logs: [], threw: null })
})

test('pack fixture cases stay behavior-equivalent', () => {
  expectEquivalent(cases.keepsLocals.input, { send: (v: unknown) => v })
  expect(run(cases.keepsLocals.input, packMangled)).toContain('Function(')
})
