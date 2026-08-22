import { expect, test } from 'vitest'

import { expandTemplateLiterals } from '../../src/preparation/expand-template-literals'
import { defineCases, run, trace } from '../helpers'

const cases = defineCases('expand-template-literals', expandTemplateLiterals, {
  staticTemplate: {
    name: 'expandTemplateLiterals converts a template with no interpolations to a string literal',
    input: `var raw = \`static text\`;`,
  },
  emptyTemplate: {
    name: 'expandTemplateLiterals converts an empty template to an empty string literal',
    input: `var empty = \`\`;`,
  },
  singleInterpolation: {
    name: 'expandTemplateLiterals rewrites a single-interpolation template as concatenation',
    input: `var msg = \`hello \${name}\`;`,
  },
  multipleInterpolations: {
    name: 'expandTemplateLiterals rewrites a multi-interpolation template as a concatenation chain',
    input: `var msg = \`hello \${name}, you are \${age}\`;`,
  },
  bareInterpolation: {
    name: 'expandTemplateLiterals keeps a leading empty string when the template is a bare interpolation',
    input: `var s = \`\${value}\`;`,
  },
  adjacentInterpolations: {
    name: 'expandTemplateLiterals chains adjacent interpolations with the leading empty string preserved',
    input: `var s = \`\${a}\${b}\`;`,
  },
  interpolatedExpression: {
    name: 'expandTemplateLiterals preserves a complex interpolated expression with parentheses',
    input: `var s = \`\${a + b}\`;`,
  },
  surroundingTextOnBothSides: {
    name: 'expandTemplateLiterals preserves text on both sides of the interpolation',
    input: `var s = \`prefix \${value} suffix\`;`,
  },
  nestedTemplate: {
    name: 'expandTemplateLiterals expands a template literal nested inside an interpolation',
    input: `var s = \`outer \${\`inner\`} end\`;`,
  },
  leavesTaggedTemplateAlone: {
    name: 'expandTemplateLiterals leaves a tagged template expression alone',
    input: `var s = tag\`hello \${name}\`;`,
  },
})

test(cases.staticTemplate.name, () => {
  const out = run(cases.staticTemplate.input, expandTemplateLiterals)
  expect(out).toContain('var raw = "static text"')
  expect(out).not.toContain('`')
})

test(cases.emptyTemplate.name, () => {
  const out = run(cases.emptyTemplate.input, expandTemplateLiterals)
  expect(out).toContain('var empty = ""')
})

// Object values can observe the different coercion hints of templates and `+`.
test(cases.singleInterpolation.name, () => {
  const out = run(cases.singleInterpolation.input, expandTemplateLiterals)
  expect(out).toContain('`hello ${name}`')
})

test(cases.multipleInterpolations.name, () => {
  const out = run(cases.multipleInterpolations.input, expandTemplateLiterals)
  expect(out).toContain('`hello ${name}, you are ${age}`')
})

test(cases.bareInterpolation.name, () => {
  const out = run(cases.bareInterpolation.input, expandTemplateLiterals)
  expect(out).toContain('`${value}`')
})

test(cases.adjacentInterpolations.name, () => {
  const out = run(cases.adjacentInterpolations.input, expandTemplateLiterals)
  expect(out).toContain('`${a}${b}`')
})

test(cases.interpolatedExpression.name, () => {
  const out = run(cases.interpolatedExpression.input, expandTemplateLiterals)
  expect(out).toContain('"" + (a + b)')
  expect(out).not.toContain('`')
})

test(cases.surroundingTextOnBothSides.name, () => {
  const out = run(cases.surroundingTextOnBothSides.input, expandTemplateLiterals)
  expect(out).toContain('`prefix ${value} suffix`')
})

test(cases.nestedTemplate.name, () => {
  const out = run(cases.nestedTemplate.input, expandTemplateLiterals)
  expect(out).toContain('"outer " + "inner" + " end"')
  expect(out).not.toContain('`')
})

test(cases.leavesTaggedTemplateAlone.name, () => {
  const out = run(cases.leavesTaggedTemplateAlone.input, expandTemplateLiterals)
  expect(out).toContain('tag`hello ${name}`')
})

function expectPreservesBehavior(src: string): string {
  const out = run(src, expandTemplateLiterals)
  expect(trace(out)).toEqual(trace(src))
  return out
}

test('expandTemplateLiterals preserves the ToString hint for an object interpolation', () => {
  expectPreservesBehavior(
    'var o = { valueOf() { return 5; }, toString() { return "s"; } }; log(`${o}`);',
  )
  expectPreservesBehavior(
    'var o = { valueOf() { return 5; }, toString() { throw new RangeError("x"); } }; try { log(`${o}`); } catch (error) { log(e.constructor.name); }',
  )
  expectPreservesBehavior('var o = { [Symbol.toPrimitive](h) { return h; } }; log(`${o}`);')
})

test('expandTemplateLiterals does not turn a template statement into a directive', () => {
  const strictBody = 'function f(...a){ `use strict`; return a.length }'
  expect(() => new Function(run(`${strictBody} f(1,2);`, expandTemplateLiterals))).not.toThrow()
  expectPreservesBehavior(`${strictBody} log(f(1, 2));`)
  expectPreservesBehavior('`use strict`; log(typeof function(){ return this; }());')
})
