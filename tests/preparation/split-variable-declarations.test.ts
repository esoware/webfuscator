import { expect, test } from 'vitest'

import { splitVariableDeclarations } from 'src/preparation/split-variable-declarations'

import { defineCases, run } from '../helpers'

const cases = defineCases('split-variable-declarations', splitVariableDeclarations, {
  multiVar: {
    name: 'splitVariableDeclarations splits a multi-declarator var into separate statements',
    input: `var a = 1, b = 2, c;`,
  },
  multiLet: {
    name: 'splitVariableDeclarations splits a multi-declarator let into separate statements',
    input: `let x = 1, y = 2;`,
  },
  multiConst: {
    name: 'splitVariableDeclarations splits a multi-declarator const into separate statements',
    input: `const p = 1, q = 2;`,
  },
  preservesDeclarationOrder: {
    name: 'splitVariableDeclarations preserves the declarator order',
    input: `var a = 1, b = 2, c = 3;`,
  },
  varMixedInitAndUninit: {
    name: 'splitVariableDeclarations splits a var with a mix of initialized and uninitialized declarators',
    input: `var a, b = 2, c;`,
  },
  insideFunctionBody: {
    name: 'splitVariableDeclarations splits multi-declarator declarations inside a function body',
    input: `function f() {
  var a = 1, b = 2;
}`,
  },
  leavesSingleDeclaratorAlone: {
    name: 'splitVariableDeclarations leaves a single-declarator declaration unchanged',
    input: `var a = 1;`,
  },
  leavesForInitAlone: {
    name: 'splitVariableDeclarations leaves multi-declarator for-init declarations alone',
    input: `for (var i = 0, j = 0; i < 10; i++) {
  log(i);
}`,
  },
  leavesExportDeclarationAlone: {
    name: 'splitVariableDeclarations leaves multi-declarator export declarations alone',
    input: `export var a = 1, b = 2;`,
  },
})

test(cases.multiVar.name, () => {
  const out = run(cases.multiVar.input, splitVariableDeclarations)
  expect(out).toContain('var a = 1;')
  expect(out).toContain('var b = 2;')
  expect(out).toContain('var c;')
  expect(out).not.toContain('var a = 1, b')
})

test(cases.multiLet.name, () => {
  const out = run(cases.multiLet.input, splitVariableDeclarations)
  expect(out).toContain('let x = 1;')
  expect(out).toContain('let y = 2;')
  expect(out).not.toContain('let x = 1, y')
})

test(cases.multiConst.name, () => {
  const out = run(cases.multiConst.input, splitVariableDeclarations)
  expect(out).toContain('const p = 1;')
  expect(out).toContain('const q = 2;')
})

test(cases.preservesDeclarationOrder.name, () => {
  const out = run(cases.preservesDeclarationOrder.input, splitVariableDeclarations)
  expect(out.indexOf('var a = 1;')).toBeLessThan(out.indexOf('var b = 2;'))
  expect(out.indexOf('var b = 2;')).toBeLessThan(out.indexOf('var c = 3;'))
})

test(cases.varMixedInitAndUninit.name, () => {
  const out = run(cases.varMixedInitAndUninit.input, splitVariableDeclarations)
  expect(out).toContain('var a;')
  expect(out).toContain('var b = 2;')
  expect(out).toContain('var c;')
})

test(cases.insideFunctionBody.name, () => {
  const out = run(cases.insideFunctionBody.input, splitVariableDeclarations)
  expect(out).toContain('var a = 1;')
  expect(out).toContain('var b = 2;')
  expect(out).not.toContain('var a = 1, b')
})

test(cases.leavesSingleDeclaratorAlone.name, () => {
  const out = run(cases.leavesSingleDeclaratorAlone.input, splitVariableDeclarations)
  expect(out).toContain('var a = 1')
})

test(cases.leavesForInitAlone.name, () => {
  const out = run(cases.leavesForInitAlone.input, splitVariableDeclarations)
  expect(out).toContain('var i = 0, j = 0')
})

test(cases.leavesExportDeclarationAlone.name, () => {
  const out = run(cases.leavesExportDeclarationAlone.input, splitVariableDeclarations)
  expect(out).toMatch(/var a = 1,\s*b = 2/)
  expect(out.match(/\bvar\b/g)?.length).toBe(1)
})
