import { expect, test } from 'vitest'

import { expandDestructuring } from '../../src/preparation/expand-destructuring'
import { defineCases, run, trace } from '../helpers'

const cases = defineCases('expand-destructuring', expandDestructuring, {
  objectSimple: {
    name: 'expandDestructuring rewrites simple object destructuring',
    input: `const { a } = obj;`,
  },
  objectRenamed: {
    name: 'expandDestructuring rewrites renamed object destructuring',
    input: `const { a: renamed } = obj;`,
  },
  objectDefault: {
    name: 'expandDestructuring rewrites object destructuring with a default value',
    input: `const { a = 3 } = obj;`,
  },
  mixedBindings: {
    name: 'expandDestructuring expands simple, renamed, and defaulted bindings together',
    input: `const { a, b: renamed, c = 3 } = obj;`,
  },
  arrayWithHoles: {
    name: 'expandDestructuring rewrites array destructuring with holes',
    input: `const [x, , y] = arr;`,
  },
  arraySimple: {
    name: 'expandDestructuring rewrites simple array destructuring',
    input: `const [a, b, c] = arr;`,
  },
  arrayDefault: {
    name: 'expandDestructuring rewrites array destructuring with a default value',
    input: `const [a = 1] = arr;`,
  },
  preservesLetAndVar: {
    name: 'expandDestructuring preserves let and var declaration kinds',
    input: `let { a } = obj1;
var [b] = arr1;`,
  },
  computedObjectKey: {
    name: 'expandDestructuring keeps computed object keys as bracket access',
    input: `const { [k]: v } = obj;`,
  },
  cachesSideEffectfulSource: {
    name: 'expandDestructuring caches a side-effectful source in a temp',
    input: `const { a, b } = compute();`,
  },
  leavesRestPatternUnchanged: {
    name: 'expandDestructuring leaves declarators containing rest patterns unchanged',
    input: `const { a, ...rest } = obj;`,
  },
})

test(cases.objectSimple.name, () => {
  const out = run(cases.objectSimple.input, expandDestructuring)
  expect(out).toContain('const a = obj.a')
  expect(out).not.toContain('{')
})

test(cases.objectRenamed.name, () => {
  const out = run(cases.objectRenamed.input, expandDestructuring)
  expect(out).toContain('const renamed = obj.a')
})

test(cases.objectDefault.name, () => {
  const out = run(cases.objectDefault.input, expandDestructuring)
  expect(out.match(/obj\.a/g)?.length).toBe(1)
  const ctx = new Function(
    'obj',
    `${out}
return a;`,
  )
  let reads = 0
  const getterObj = Object.defineProperty({}, 'a', {
    get() {
      reads++
      return undefined
    },
  })
  expect(ctx(getterObj)).toBe(3)
  expect(reads).toBe(1)
  expect(ctx({ a: 7 })).toBe(7)
})

test(cases.mixedBindings.name, () => {
  const out = run(cases.mixedBindings.input, expandDestructuring)
  // Three property reads require one source snapshot.
  const tempMatch = out.match(/const (\w+) = obj/)
  expect(tempMatch).not.toBeNull()
  const temp = tempMatch![1]
  expect(out).toContain(`const a = ${temp}.a`)
  expect(out).toContain(`const renamed = ${temp}.b`)
  const get = new Function(
    'obj',
    `${out}
return [a, renamed, c];`,
  )
  expect(get({ a: 1, b: 2, c: 9 })).toEqual([1, 2, 9])
  expect(get({ a: 1, b: 2 })).toEqual([1, 2, 3])
})

// Indexed reads cannot reproduce the array iterator protocol.
test(cases.arrayWithHoles.name, () => {
  const out = run(cases.arrayWithHoles.input, expandDestructuring)
  expect(out).toContain('const [x,, y] = arr')
})

test(cases.arraySimple.name, () => {
  const out = run(cases.arraySimple.input, expandDestructuring)
  expect(out).toContain('const [a, b, c] = arr')
})

test(cases.arrayDefault.name, () => {
  const out = run(cases.arrayDefault.input, expandDestructuring)
  expect(out).toContain('const [a = 1] = arr')
})

test(cases.preservesLetAndVar.name, () => {
  const out = run(cases.preservesLetAndVar.input, expandDestructuring)
  expect(out).toContain('let a = obj1.a')
  expect(out).toContain('var [b] = arr1')
})

test(cases.computedObjectKey.name, () => {
  const out = run(cases.computedObjectKey.input, expandDestructuring)
  expect(out).toContain('const v = obj[k]')
})

test(cases.cachesSideEffectfulSource.name, () => {
  const out = run(cases.cachesSideEffectfulSource.input, expandDestructuring)
  expect(out.match(/compute\(\)/g)?.length).toBe(1)
  const tempMatch = out.match(/const (\w+) = compute\(\)/)
  expect(tempMatch).not.toBeNull()
  const temp = tempMatch![1]
  expect(out).toContain(`const a = ${temp}.a`)
  expect(out).toContain(`const b = ${temp}.b`)
})

test(cases.leavesRestPatternUnchanged.name, () => {
  const out = run(cases.leavesRestPatternUnchanged.input, expandDestructuring)
  expect(out).toContain('...rest')
  expect(out).toContain('= obj')
})

function expectPreservesBehavior(src: string): string {
  const out = run(src, expandDestructuring)
  expect(trace(out)).toEqual(trace(src))
  return out
}

test('expandDestructuring leaves array patterns intact (iterator protocol)', () => {
  expectPreservesBehavior('function* g() { log("side"); yield 7; } let [a] = g(); log(a);')
  expectPreservesBehavior('let [a, b] = new Set([1, 2]); log(a, b);')
  expectPreservesBehavior('let [a] = "\u{1F600}"; log(a);')
  expectPreservesBehavior(
    'let r; try { let [a] = {}; r = "noThrow"; } catch (error) { r = error.constructor.name; } log(r);',
  )
  expectPreservesBehavior(
    'let r; try { let [a] = 5; r = "noThrow"; } catch (error) { r = error.constructor.name; } log(r);',
  )
})

test('expandDestructuring runs a nested getter or computed key once', () => {
  expectPreservesBehavior(
    'let o = { get a() { log("get"); return { b: 1, c: 2 }; } }; let { a: { b, c } } = o; log(b, c);',
  )
  expectPreservesBehavior(
    'function k(){ log("k"); return "a"; } let o = { a: { b: 1, c: 2 } }; let { [k()]: { b, c } } = o; log(b, c);',
  )
})

test('expandDestructuring reads the source once even for an identifier source', () => {
  expectPreservesBehavior(
    'let o = { b: 2 }; let r; try { let { a = (o = null, 1), b } = o; r = a + "/" + b; } catch (error) { r = error.constructor.name; } log(r);',
  )
})

test('expandDestructuring compares a default against unshadowable void 0', () => {
  expectPreservesBehavior(
    'function t() { let undefined = 42; let { a = 7 } = {}; return a; } log(t());',
  )
})

test('expandDestructuring keeps an empty object pattern, which still coerces its source', () => {
  expectPreservesBehavior(
    'let r; try { let {} = null; r = "ok"; } catch (error) { r = error.constructor.name; } log(r);',
  )
  expectPreservesBehavior(
    'let r; try { let { a: {} } = { a: undefined }; r = "ok"; } catch (error) { r = error.constructor.name; } log(r);',
  )
})

// A09-07: RequireObjectCoercible runs before any computed key.
test('expandDestructuring does not evaluate a computed key against a nullish source', () => {
  expectPreservesBehavior(
    'let r; try { const { [(log("k"), "a")]: a } = null; } catch (e) { r = "threw"; } log(r);',
  )
  expectPreservesBehavior(
    'let r; try { const { [(log("k"), "a")]: a } = undefined; } catch (e) { r = "threw"; } log(r);',
  )
  expectPreservesBehavior(
    'let r; try { const { a: { [(log("k"), "b")]: b } } = { a: null }; } catch (e) { r = "threw"; } log(r);',
  )
})

test('expandDestructuring guards a computed key read with RequireObjectCoercible', () => {
  const out = run('const { [k]: v } = obj;', expandDestructuring)
  expect(out).toContain('({} = obj)')
  expect(out).toContain('const v = obj[k]')
  expect(out.indexOf('({} = obj)')).toBeLessThan(out.indexOf('obj[k]'))
})

// A09-08 / A09-09: A `with` object can shadow synthesized temporaries.
test('expandDestructuring leaves a destructuring inside `with` intact', () => {
  const out = expectPreservesBehavior(
    'var o = { a: 1, b: 2, _ref: 0 };\n' +
      'function f() { with (o) { var { a: x, b: y } = o; return [x, y]; } }\n' +
      'log(f(), o._ref);',
  )
  expect(out).toContain('var {')
  expect(out).not.toContain('_ref = o')
  expectPreservesBehavior(
    'var o = { a: undefined, _a: 0 };\n' +
      'function f() { with (o) { var { a = 7 } = o; return a; } }\n' +
      'log(f(), o._a);',
  )
})

// A09-10: Direct eval can observe a generated name Babel cannot see.
test('expandDestructuring leaves a destructuring intact when the scope has a direct eval', () => {
  const out = expectPreservesBehavior(
    'function f() { var { a, b } = { a: 1, b: 2 }; return eval("typeof _ref"); }\nlog(f());',
  )
  expect(out).toContain('var {')
})
