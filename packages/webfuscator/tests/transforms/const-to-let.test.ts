import { expect, test } from 'vitest'

import { constToLet } from '../../src/transforms/const-to-let'
import { defineCases, run } from '../helpers'

// Compare logs and thrown classes before and after relaxing `const`.
function capture(code: string): { logs: string[]; threw: string | null } {
  const logs: string[] = []
  try {
    // oxlint-disable-next-line no-new-func
    new Function('log', code)((...values: unknown[]) => logs.push(values.map(String).join('|')))
    return { logs, threw: null }
  } catch (error) {
    return { logs, threw: (error as Error).constructor.name }
  }
}

function expectEquivalent(input: string): string {
  const out = run(input, constToLet)
  expect(capture(out)).toEqual(capture(input))
  return out
}

const cases = defineCases('const-to-let', constToLet, {
  simpleConst: {
    name: 'constToLet rewrites a simple const declaration as let',
    input: `const foo = "bar"; log(foo);`,
  },
  destructuredConst: {
    name: 'constToLet rewrites a destructured const declaration as let',
    input: `const { a, b } = { a: 1, b: 2 }; log(a, b);`,
  },
  arrayDestructuredConst: {
    name: 'constToLet rewrites an array-destructured const declaration as let',
    input: `const [x, y] = [1, 2]; log(x, y);`,
  },
  multiDeclaratorConst: {
    name: 'constToLet rewrites a multi-declarator const declaration as let',
    input: `const a = 1, b = 2; log(a, b);`,
  },
  forOfInit: {
    name: 'constToLet rewrites const used as the binding of a for-of loop',
    input: `for (const x of [1, 2]) { log(x); }`,
  },
  leavesLetAlone: {
    name: 'constToLet leaves let declarations unchanged',
    input: `let x = 1; log(x);`,
  },
  leavesVarAlone: {
    name: 'constToLet leaves var declarations unchanged',
    input: `var x = 1; log(x);`,
  },
  mixedDeclarations: {
    name: 'constToLet rewrites only the const declarations in a mixed block',
    input: `const a = 1;
let b = 2;
var c = 3;
log(a, b, c);`,
  },
  reassignedConst: {
    name: 'constToLet rewrites a reassigned const',
    input: `const a = 1; try { a = 2; } catch (e) { log(e.constructor.name); } log(a);`,
  },
  forHeadUpdateConst: {
    name: 'constToLet rewrites a for-head const whose update reassigns it',
    input: `try { for (const i = 0; i < 3; i++) { log(i); } } catch (e) { log(e.constructor.name); }`,
  },
  evalConst: {
    name: 'constToLet does not skip a scope containing eval',
    input: `const a = 1; try { eval("a = 2"); } catch (e) { log(e.constructor.name); } log(a);`,
  },
})

test(cases.simpleConst.name, () => {
  const out = expectEquivalent(cases.simpleConst.input)
  expect(out).toContain('let foo = "bar"')
  expect(out).not.toContain('const')
})

test(cases.destructuredConst.name, () => {
  const out = expectEquivalent(cases.destructuredConst.input)
  expect(out).toMatch(/let\s*\{\s*a,\s*b\s*\}/)
  expect(out).not.toContain('const')
})

test(cases.arrayDestructuredConst.name, () => {
  const out = expectEquivalent(cases.arrayDestructuredConst.input)
  expect(out).toContain('let [x, y]')
})

test(cases.multiDeclaratorConst.name, () => {
  const out = expectEquivalent(cases.multiDeclaratorConst.input)
  expect(out).toMatch(/let a = 1,\s*b = 2/)
})

test(cases.forOfInit.name, () => {
  const out = expectEquivalent(cases.forOfInit.input)
  expect(out).toContain('for (let x of')
})

test(cases.leavesLetAlone.name, () => {
  const out = expectEquivalent(cases.leavesLetAlone.input)
  expect(out).toContain('let x = 1')
})

test(cases.leavesVarAlone.name, () => {
  const out = expectEquivalent(cases.leavesVarAlone.input)
  expect(out).toContain('var x = 1')
})

test(cases.mixedDeclarations.name, () => {
  const out = expectEquivalent(cases.mixedDeclarations.input)
  expect(out).toContain('let a = 1')
  expect(out).toContain('let b = 2')
  expect(out).toContain('var c = 3')
  expect(out).not.toContain('const')
})

test(cases.reassignedConst.name, () => {
  const out = run(cases.reassignedConst.input, constToLet)
  expect(out).toContain('let a = 1')
})

test(cases.forHeadUpdateConst.name, () => {
  const out = run(cases.forHeadUpdateConst.input, constToLet)
  expect(out).toContain('for (let i = 0')
})

test(cases.evalConst.name, () => {
  const out = run(cases.evalConst.input, constToLet)
  expect(out).toContain('let a = 1')
})
