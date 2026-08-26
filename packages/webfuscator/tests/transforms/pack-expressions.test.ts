import generate from '@babel/generator'
import { parse } from '@babel/parser'
import * as t from '@babel/types'
import { expect, test } from 'vitest'

import { obfuscate } from '../../src/index'
import { packExpressions } from '../../src/transforms/pack-expressions'
import { defineCases, run, trace } from '../helpers'

function expectEquivalent(input: string): string {
  const out = run(input, packExpressions)
  expect(trace(out)).toEqual(trace(input))
  return out
}

function runtimeSupportsExplicitResourceManagement(): boolean {
  try {
    // oxlint-disable-next-line no-new-func
    const parsed = new Function(
      'using resource = null; return async function () { await using resource = null; }',
    )
    return typeof parsed === 'function'
  } catch {
    return false
  }
}

const cases = defineCases('pack-expressions', packExpressions, {
  adjacentLets: {
    name: 'packExpressions fuses consecutive let declarations',
    input: `let a = 1;\nlet b = 2;\nlog(a + b);`,
  },
  adjacentConsts: {
    name: 'packExpressions fuses consecutive const declarations',
    input: `const a = 1;\nconst b = a + 1;\nlog(a + b);`,
  },
  returnValue: {
    name: 'packExpressions moves a straight-line run into a return value',
    input: `function run() {
  log("prepare");
  log("update");
  return 7;
}
log(run());`,
  },
  trailingRun: {
    name: 'packExpressions joins a trailing run without adding a call',
    input: `log("first");
log("second");
log("third");`,
  },
  nestedContainers: {
    name: 'packExpressions handles blocks, switch cases, and static blocks',
    input: `{
  log("block-a");
  log("block-b");
}
switch (1) {
  case 1:
    log("case-a");
    log("case-b");
}
class Box {
  static {
    log("static-a");
    log("static-b");
  }
}`,
  },
})

test('fuses consecutive same-kind declarations into one', () => {
  const out = expectEquivalent(`let a = 1;\nlet b = 2;\nlog(a + b);`)
  expect(out).toContain('let a = 1,')
  expect(out).not.toMatch(/let b/u)
})

test('preserves left-to-right evaluation when a later declarator reads an earlier one', () => {
  expect(trace(run(`let a = 1;\nlet b = a + 1;\nlog(b);`, packExpressions))).toEqual({
    logs: [2],
    threw: null,
  })
})

test('does not merge declarations across a different kind', () => {
  const out = expectEquivalent(`let a = 1;\nconst b = 2;\nlog(a + b);`)
  expect(out).toContain('let a = 1;')
  expect(out).toContain('const b = 2;')
})

test('does not merge declarations across an intervening statement', () => {
  const source = `let a = 1;\nlog(a);\nlet b = 2;\nlog(b);`
  const out = expectEquivalent(source)
  expect(out).toContain('let a = 1;')
  expect(out).toContain('let b = 2;')
})

test('preserves declaration initializer side-effect order', () => {
  const source = `let order = [];\nlet a = (order.push(1), 1);\nlet b = (order.push(2), 2);\nlog(order.join(","));`
  expect(trace(run(source, packExpressions))).toEqual({ logs: ['1,2'], threw: null })
})

test('merges var declarations', () => {
  const out = expectEquivalent(`var a = 1;
var b = 2;
log(a + b);`)
  expect(out).toContain('var a = 1,')
})

test('merges declarations inside blocks and switch cases', () => {
  const source = `{
  let a = 1;
  let b = 2;
  log(a + b);
}
switch (1) {
  case 1:
    let c = 3;
    let d = 4;
    log(c + d);
}`
  const out = expectEquivalent(source)
  expect(out).toContain('let a = 1,')
  expect(out).toContain('let c = 3,')
})

test('merges declarations inside static initialization blocks', () => {
  const source = `class C {
  static {
    let a = 1;
    let b = 2;
    log(a + b);
  }
}`
  const out = expectEquivalent(source)
  expect(out).toContain('let a = 1,')
})

test('merges adjacent direct exports', () => {
  const out = run(
    `export let a = 1;
export let b = 2;`,
    packExpressions,
  )
  expect(out).toContain('export let a = 1,')
  expect(() => parse(out, { sourceType: 'module' })).not.toThrow()
})

test('merges declarations across unlabeled empty statements', () => {
  const out = expectEquivalent(`let a = 1;
;
let b = 2;
log(a + b);`)
  expect(out).toContain('let a = 1,')
  expect(out).not.toContain('\n;')
})

test('merges declarations containing functions and classes', () => {
  const source = `let make = function () { return 1; };
let Box = class { value() { return 2; } };
log(make() + new Box().value());`
  const out = expectEquivalent(source)
  expect(out).toContain('let make = function ()')
  expect(out).not.toMatch(/\nlet Box/u)
})

test('preserves abrupt declaration initializer completion', () => {
  const source = `try {
  let a = (() => { throw 1; })();
  let b = 2;
} catch (error) {
  log(error);
}`
  expectEquivalent(source)
})

test('merges using declarations without changing disposal order', () => {
  const source = `const resourceA = { [Symbol.dispose]() { log("a"); } };
const resourceB = { [Symbol.dispose]() { log("b"); } };
{
  using a = resourceA;
  using b = resourceB;
  log("body");
}`
  const out = run(source, packExpressions)
  expect(out).toContain('using a =')
  expect(out).not.toMatch(/\n\s*using b/u)
  if (!runtimeSupportsExplicitResourceManagement()) {
    return
  }
  expect(trace(out)).toEqual(trace(source))
  expect(trace(out)).toEqual({ logs: ['body', 'b', 'a'], threw: null })
})

test('merges await using declarations without changing asynchronous disposal order', async () => {
  const source = `const resourceA = { async [Symbol.asyncDispose]() { log("a"); } };
const resourceB = { async [Symbol.asyncDispose]() { log("b"); } };
async function f() {
  await using a = resourceA;
  await using b = resourceB;
  log("body");
}`
  const out = run(source, packExpressions)
  expect(out).not.toMatch(/\n\s*await using b/u)
  if (!runtimeSupportsExplicitResourceManagement()) {
    return
  }

  const evaluate = async (code: string): Promise<string[]> => {
    const logs: string[] = []
    // oxlint-disable-next-line no-new-func
    const promise = new Function('log', `${code}\nreturn f();`)((value: string) => logs.push(value))
    await promise
    return logs
  }
  expect(await evaluate(out)).toEqual(await evaluate(source))
  expect(await evaluate(out)).toEqual(['body', 'b', 'a'])
})

test('reports no change after declarations and expressions are packed', () => {
  const ast = parse(`let a = 1;
let b = 2;
first();
second();`)
  expect(packExpressions(ast)).toBe(true)
  const once = generate(ast).code
  expect(packExpressions(ast)).toBe(false)
  expect(generate(ast).code).toBe(once)
})

test.each([
  {
    name: 'valued return',
    pattern: /return log\("head"\), 1;/u,
    source: `function f() { log("head"); return 1; } log(f());`,
  },
  {
    name: 'bare return',
    pattern: /return log\("head"\), void 0;/u,
    source: `function f() { log("head"); return; } log(f());`,
  },
  {
    name: 'throw',
    pattern: /throw log\("head"\), new Error\("boom"\);/u,
    source: `function f() { log("head"); throw new Error("boom"); }
try { f(); } catch (error) { log(error.message); }`,
  },
  {
    name: 'if test',
    pattern: /if \(log\("head"\), value\)/u,
    source: `var value = true; log("head"); if (value) log("body");`,
  },
  {
    name: 'switch discriminant',
    pattern: /switch \(log\("head"\), value\)/u,
    source: `var value = 1;
log("head");
switch (value) { case 1: log("body"); }`,
  },
  {
    name: 'with object',
    pattern: /with \(log\("head"\), environment\)/u,
    source: `var environment = { value: 1 };
log("head");
with (environment) log(value);`,
  },
  {
    name: 'empty classic for initializer',
    pattern: /for \(log\("head"\); i < 1; i\+\+\)/u,
    source: `var i = 0; log("head"); for (; i < 1; i++) log(i);`,
  },
  {
    name: 'expression classic for initializer',
    pattern: /for \(log\("head"\), i = 0; i < 1; i\+\+\)/u,
    source: `var i = 2; log("head"); for (i = 0; i < 1; i++) log(i);`,
  },
  {
    name: 'for-in assignment target',
    pattern: /for \(key in log\("head"\),/u,
    source: `var key; log("head"); for (key in { value: 1 }) log(key);`,
  },
  {
    name: 'for-in var declaration',
    pattern: /for \(var key in log\("head"\),/u,
    source: `log("head"); for (var key in { value: 1 }) log(key);`,
  },
  {
    name: 'for-of assignment target',
    pattern: /for \(value of \(log\("head"\),/u,
    source: `var value; log("head"); for (value of [1]) log(value);`,
  },
  {
    name: 'for-of var declaration',
    pattern: /for \(var value of \(log\("head"\),/u,
    source: `log("head"); for (var value of [1]) log(value);`,
  },
])('absorbs a pending run into a one-shot $name', ({ pattern, source }) => {
  const out = expectEquivalent(source)
  expect(out).toMatch(pattern)
})

test.each([
  {
    name: 'classic for lexical initializer',
    source: `let value = "outer";
log(value);
for (let value = value; false; ) {}`,
  },
  {
    name: 'for-in lexical right side',
    source: `let key = "outer";
log(key);
for (let key in { [key]: 1 }) {}`,
  },
  {
    name: 'for-of lexical right side',
    source: `let value = "outer";
log(value);
for (let value of [value]) {}`,
  },
])('keeps a preceding expression outside the $name environment', ({ source }) => {
  const out = expectEquivalent(source)
  expect(out.indexOf('log(')).toBeLessThan(out.indexOf('for ('))
  expect(trace(out).logs).toEqual(['outer'])
  expect(trace(out).threw).toBe('ReferenceError')
})

test('keeps a preceding expression before a legacy for-in var initializer', () => {
  const source = `function mark(value) { log(value); return { key: 1 }; }
log("before");
for (var key = log("initializer") in mark("right")) {}`
  const out = expectEquivalent(source)
  expect(trace(out)).toEqual({ logs: ['before', 'initializer', 'right'], threw: null })
  expect(out).toMatch(/log\("before"\);\nfor \(var key =/u)
})

test.each([
  ['using', `log("head"); for (using resource of resources) {}`],
  ['await using', `async function f() { log("head"); for (await using resource of resources) {} }`],
])('keeps a preceding expression outside a %s for-of head', (_, source) => {
  const out = run(source, packExpressions)
  expect(out).toMatch(/log\("head"\);\s*for \(/u)
})

test('does not absorb expressions into repeating or structurally different statements', () => {
  const source = `log("while-a");
log("while-b");
while (false) {}
log("do-a");
log("do-b");
do {} while (false);
log("try-a");
log("try-b");
try {} finally {}
log("label-a");
log("label-b");
label: log("labeled");`
  const out = expectEquivalent(source)
  expect(out).toMatch(/log\("while-a"\), log\("while-b"\);\nwhile/u)
  expect(out).toMatch(/log\("do-a"\), log\("do-b"\);\ndo/u)
  expect(out).toMatch(/log\("try-a"\), log\("try-b"\);\ntry/u)
  expect(out).toMatch(/log\("label-a"\), log\("label-b"\);\nlabel:/u)
})

test('does not cross debugger statements or declarations', () => {
  const source = `log("debugger-a");
log("debugger-b");
debugger;
log("declaration-a");
log("declaration-b");
let value = 1;
log(value);`
  const out = expectEquivalent(source)
  expect(out).toMatch(/log\("debugger-a"\), log\("debugger-b"\);\ndebugger;/u)
  expect(out).toMatch(/log\("declaration-a"\), log\("declaration-b"\);\nlet value/u)
})

test('keeps module declarations as statement-list barriers', () => {
  const ast = parse(
    `import value from "package";
first();
second();
export { value };`,
    { sourceType: 'module' },
  )
  expect(packExpressions(ast)).toBe(true)
  expect(ast.program.body.map((statement) => statement.type)).toEqual([
    'ImportDeclaration',
    'ExpressionStatement',
    'ExportNamedDeclaration',
  ])
  const packed = ast.program.body[1]
  expect(t.isExpressionStatement(packed) && t.isSequenceExpression(packed.expression)).toBe(true)
})

test('preserves directives while packing the following function body', () => {
  const source = `function f() {
  "use strict";
  log(this === undefined);
  log("tail");
}
f();`
  const out = expectEquivalent(source)
  expect(out).toMatch(/function f\(\) \{\n  "use strict";/u)
  expect(trace(out)).toEqual({ logs: [true, 'tail'], threw: null })
})

test('preserves calls, construction, direct eval, optional receivers, and super', () => {
  const source = `var object = {
  method() { log(this === object); }
};
log("method");
object.method();
log("optional");
object.method?.();
function Box() { log(new.target === Box); }
log("construct");
new Box();
function evaluate() {
  var local = 7;
  log("eval");
  eval("log(local)");
}
evaluate();
class Base {
  constructor() { log("base"); }
  method() { log(this instanceof Derived); }
}
class Derived extends Base {
  constructor() { log("before-super"); super(); }
  method() { log("before-method"); super.method(); }
}
new Derived().method();`
  const out = expectEquivalent(source)
  expect(trace(out)).toEqual({
    logs: [
      'method',
      true,
      'optional',
      true,
      'construct',
      true,
      'eval',
      7,
      'before-super',
      'base',
      'before-method',
      true,
    ],
    threw: null,
  })
})

test('does not add coercion around symbols, getters, or proxies', () => {
  const source = `const value = {
  [Symbol.toPrimitive]() { log("coerced"); return 1; }
};
const target = {
  get property() { log("getter"); return value; }
};
const proxy = new Proxy(target, {
  get(object, key, receiver) {
    log("proxy");
    return Reflect.get(object, key, receiver);
  }
});
target.property;
proxy.property;
value;
Symbol();
log("done");`
  const out = expectEquivalent(source)
  expect(trace(out)).toEqual({ logs: ['getter', 'proxy', 'getter', 'done'], threw: null })
})

test('preserves iterator acquisition and per-iteration closures', () => {
  const source = `const functions = [];
const iterable = {
  [Symbol.iterator]() {
    log("iterator");
    return [1, 2][Symbol.iterator]();
  }
};
log("head");
for (let value of iterable) {
  log(value);
  functions.push(() => value);
}
log(functions[0](), functions[1]());`
  const out = expectEquivalent(source)
  expect(trace(out)).toEqual({ logs: ['head', 'iterator', 1, 2, [1, 2]], threw: null })
})

test('preserves abrupt completion before the final expression', () => {
  const source = `function fail() { log("fail"); throw new TypeError("boom"); }
function run() {
  log("before");
  fail();
  return log("unreachable");
}
try { run(); } catch (error) { log(error.constructor.name); }`
  expect(trace(expectEquivalent(source))).toEqual({
    logs: ['before', 'fail', 'TypeError'],
    threw: null,
  })
})

test('preserves suspension order in async functions', async () => {
  const source = `async function execute() {
  log("before");
  await Promise.resolve(log("await"));
  log("after");
  return 4;
}`
  const out = run(source, packExpressions)
  const evaluate = async (code: string): Promise<{ logs: unknown[]; value: unknown }> => {
    const logs: unknown[] = []
    // oxlint-disable-next-line no-new-func
    const execute = new Function('log', `${code}\nreturn execute();`)
    const value = await execute((entry: unknown) => logs.push(entry))
    return { logs, value }
  }
  expect(await evaluate(out)).toEqual(await evaluate(source))
  expect(await evaluate(out)).toEqual({ logs: ['before', 'await', 'after'], value: 4 })
})

test('preserves suspension order in generators', () => {
  const source = `function* execute() {
  log("before");
  yield log("yield");
  log("after");
  return 4;
}
const iterator = execute();
log(iterator.next().value);
log(iterator.next().value);`
  expectEquivalent(source)
})

test('flattens only sequence expressions that join the packed run', () => {
  const ast = parse(`function f() {
  first(), second();
  third();
  return fourth(), fifth();
}`)
  expect(packExpressions(ast)).toBe(true)
  const declaration = ast.program.body[0]
  expect(t.isFunctionDeclaration(declaration)).toBe(true)
  if (!t.isFunctionDeclaration(declaration)) {
    return
  }
  const [statement] = declaration.body.body
  expect(t.isReturnStatement(statement) && t.isSequenceExpression(statement.argument)).toBe(true)
  if (!t.isReturnStatement(statement) || !t.isSequenceExpression(statement.argument)) {
    return
  }
  expect(statement.argument.expressions).toHaveLength(5)
  expect(
    statement.argument.expressions.every((expression) => !t.isSequenceExpression(expression)),
  ).toBe(true)

  const once = generate(ast).code
  expect(packExpressions(ast)).toBe(false)
  expect(generate(ast).code).toBe(once)
})

test('leaves a lone trailing sequence expression unchanged', () => {
  const ast = parse(`first(), second();`)
  const before = generate(ast).code
  expect(packExpressions(ast)).toBe(false)
  expect(generate(ast).code).toBe(before)
})

test('introduces only a sequence node for a plain expression run', () => {
  const ast = parse(`first;
second;
third;`)
  expect(packExpressions(ast)).toBe(true)
  expect(ast.program.body).toHaveLength(1)
  const forbidden = new Set([
    'ArrayExpression',
    'CallExpression',
    'FunctionExpression',
    'NewExpression',
    'ObjectExpression',
    'UnaryExpression',
  ])
  const introduced: string[] = []
  t.traverseFast(ast, (node) => {
    if (forbidden.has(node.type)) {
      introduced.push(node.type)
    }
  })
  expect(introduced).toEqual([])
})

test('packs more expressions than a dummy call can accept', () => {
  const expressionCount = 70_000
  const source = `var counter = 0;
${Array.from({ length: expressionCount }, () => 'counter += 1;').join('\n')}
log(counter);`
  const out = expectEquivalent(source)
  const ast = parse(out)
  expect(ast.program.body).toHaveLength(2)
  const statement = ast.program.body[1]
  expect(t.isExpressionStatement(statement) && t.isSequenceExpression(statement.expression)).toBe(
    true,
  )
  if (!t.isExpressionStatement(statement) || !t.isSequenceExpression(statement.expression)) {
    return
  }
  expect(statement.expression.expressions).toHaveLength(expressionCount + 1)
})

test('runs only when its option is true', () => {
  const source = `first();
second();`
  const omitted = obfuscate(source)
  const withTransform = obfuscate(source, { transforms: { packExpressions: true } })
  expect(omitted).toMatch(/first\(\);\nsecond\(\);/u)
  expect(withTransform).toMatch(/first\(\), second\(\);/u)
})

test('merges declarations generated by preceding transforms', () => {
  const source = `log("protected value");`
  const unpacked = obfuscate(source, {
    transforms: { concealStrings: { cover: 'used' } },
  })
  const packed = obfuscate(source, {
    transforms: { concealStrings: { cover: 'used' }, packExpressions: true },
  })
  const programVariableCount = (code: string): number =>
    parse(code, { sourceType: 'unambiguous' }).program.body.filter((statement) =>
      t.isVariableDeclaration(statement),
    ).length
  expect(programVariableCount(unpacked)).toBe(2)
  expect(programVariableCount(packed)).toBe(1)
  expect(trace(packed)).toEqual(trace(source))
})

test('fixture cases stay behavior-equivalent', () => {
  for (const fixture of Object.values(cases)) {
    expect(trace(run(fixture.input, packExpressions))).toEqual(trace(fixture.input))
  }
})
