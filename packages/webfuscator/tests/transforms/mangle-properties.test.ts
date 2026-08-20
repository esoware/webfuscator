import { parse } from '@babel/parser'
import type { File } from '@babel/types'
import { expect, test } from 'vitest'

import type { ManglePropertiesOptions, TransformContext } from 'src/options'
import { mangleProperties } from 'src/transforms/mangle-properties'

import { defineCases, run, trace } from '../helpers'

const BASE_CONTEXT: TransformContext = { seed: 0, stringGeneratorMode: 'mangled' }

function apply(options: ManglePropertiesOptions = {}, context = BASE_CONTEXT) {
  return (ast: File): boolean => mangleProperties(ast, { ...context, mangleProperties: options })
}

function transform(code: string, options: ManglePropertiesOptions = {}): string {
  return run(code, apply(options))
}

function sequentialName(index: number): string {
  return `p${index}`
}

function propertyFamilyProgram(names: readonly string[]): string {
  const properties = names.map((name, index) => `${name}: ${index}`).join(', ')
  const reads = names.map((name) => `object.${name}`).join(' + ')
  return `var object = { ${properties} }; log(${reads});`
}

const fixtureOptions = { nameGenerator: sequentialName }

const cases = defineCases('mangle-properties', apply(fixtureOptions), {
  objectPropertiesAndMembers: {
    name: 'mangleProperties renames object keys, methods, and matching member accesses',
    input: `var counter = {
  current_: 1,
  increment_() { return ++this.current_; }
};
log(counter.increment_());`,
  },
  classPropertiesAndMembers: {
    name: 'mangleProperties renames class fields, methods, accessors, and static properties',
    input: `class Box {
  value_ = 2;
  static scale_ = 3;
  get doubled_() { return this.value_ * 2; }
  method_() { return this.doubled_ * Box.scale_; }
}
log(new Box().method_());`,
  },
  destructuring: {
    name: 'mangleProperties keeps object definitions and destructuring keys aligned',
    input: `var source = { first_: 1, second_: 2 };
var { first_: first, second_: second } = source;
log(first + second);`,
  },
  reflectiveKeys: {
    name: 'mangleProperties rewrites defineProperty and in-operator string keys',
    input: `var object = {};
Object.defineProperty(object, "hidden_", { value: 7 });
log("hidden_" in object, object.hidden_);`,
  },
  shorthand: {
    name: 'mangleProperties expands shorthand when only the property name changes',
    input: `var secret_ = 4;
var object = { secret_ };
log(object.secret_);`,
  },
})

for (const fixture of Object.values(cases)) {
  test(fixture.name, () => {
    const out = transform(fixture.input, fixtureOptions)
    expect(trace(out)).toEqual(trace(fixture.input))
    expect(out).not.toBe(run(fixture.input, () => {}))
  })
}

test('mangleProperties applies one mapping across definitions, reads, writes, deletes, and optional reads', () => {
  const input = `var object = { secret_: 1 };
object.secret_ = object.secret_ + 1;
log(object?.secret_);
delete object.secret_;
log("secret_" in object);`
  const out = transform(input, {
    builtins: true,
    nameGenerator: () => 'renamed',
    regex: /_$/,
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).not.toContain('secret_')
  expect(out.match(/renamed/g)?.length).toBeGreaterThan(3)
})

test('mangleProperties rewrites both terminal arms of conditional computed keys', () => {
  const input = `var choose = true;
var object = { left_: 3, right_: 4 };
log(object[choose ? "left_" : "right_"]);
choose = false;
log(object[choose ? "left_" : "right_"]);`
  const out = transform(input, {
    builtins: true,
    nameGenerator: sequentialName,
    regex: /_$/,
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).not.toContain('left_')
  expect(out).not.toContain('right_')
})

test('mangleProperties rewrites only the value-producing tail of a sequence key', () => {
  const input = `var object = { used_: 5 };
log(object[("not-a-key", "used_")]);`
  const out = transform(input, {
    builtins: true,
    nameGenerator: () => 'renamed',
    regex: /_$/,
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).toContain('"not-a-key"')
  expect(out).not.toContain('used_')
})

test('mangleProperties rewrites statically evaluable computed keys', () => {
  const inputs = [
    'var object = { secret_: 5 }; log(object[`secret_`]);',
    'var object = { secret_: 5 }; log(object["sec" + "ret_"]);',
    'var object = { ["sec" + "ret_"]: 5 }; log(object.secret_);',
    'class Box { [`secret_`] = 5; } log(new Box().secret_);',
    'var object = { secret_: 5 }; log(object[true ? "sec" + "ret_" : "unused"]);',
    'var object = { secret_: 5 }; function read(condition) { return object[condition && "secret_"]; } log(read(true), read(false));',
  ]
  for (const input of inputs) {
    const out = transform(input, {
      builtins: true,
      nameGenerator: () => 'renamed',
      regex: /_$/,
    })
    expect(trace(out)).toEqual(trace(input))
    expect(out).not.toContain('secret_')
  }
})

test('mangleProperties follows constant bindings used as computed keys', () => {
  const input = `const key = "secret_";
var object = { secret_: 6 };
log(object[key]);`
  const out = transform(input, {
    builtins: true,
    nameGenerator: () => 'renamed',
    regex: /_$/,
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).not.toMatch(/object\[key\]/)
})

test('mangleProperties rewrites constant bindings in reflective property operations', () => {
  const input = `const key = "hidden_";
var object = {};
Object.defineProperty(object, key, { value: 7 });
log(object.hidden_, key in object);`
  const out = transform(input, {
    nameGenerator: () => 'renamed',
    regex: /_$/,
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).not.toMatch(/defineProperty\(object, key/)
  expect(out).not.toMatch(/key in object/)
})

test('mangleProperties recognizes static and optional defineProperty callees', () => {
  for (const callee of [
    'Object["defineProperty"]',
    'Object[`defineProperty`]',
    'Object["define" + "Property"]',
    'Object?.defineProperty',
    'Object?.["defineProperty"]',
    'Object.defineProperty?.',
  ]) {
    const input = `var object = {};
${callee}(object, "hidden_", { value: 7 });
log(object.hidden_);`
    const out = transform(input, {
      nameGenerator: () => 'renamed',
      regex: /_$/,
    })
    expect(trace(out)).toEqual(trace(input))
    expect(out).not.toContain('hidden_')
  }
})

test('mangleProperties leaves dynamic computed keys alone', () => {
  const input = `var key = read(); var object = {}; object[key] = 1; log(object[key]);`
  expect(transform(input, { builtins: true, nameGenerator: sequentialName })).toBe(
    run(input, () => {}),
  )
})

test('mangleProperties refuses numeric property names', () => {
  const input = `var object = { 1: "one", "2.5": "two" }; log(object[1], object["2.5"]);`
  const out = transform(input, { builtins: true, nameGenerator: sequentialName })
  expect(trace(out)).toEqual(trace(input))
  expect(out).toContain('1:')
  expect(out).toContain('"2.5"')
})

test('mangleProperties keeps primitive literal keys and accesses aligned', () => {
  const input = `var value = 1;
var object = {
  get true() { return value; },
  set false(next) { value = next; },
  null: 3,
  undefined: 4,
  Infinity: 5,
  NaN: 6
};
object[false] = 2;
log(object[true], object[null], object[undefined], object[1 / 0], object[0 / 0]);`
  const out = transform(input, {
    builtins: true,
    nameGenerator: sequentialName,
  })
  expect(trace(out)).toEqual(trace(input))
  for (const name of ['true', 'false', 'null', 'undefined', 'Infinity', 'NaN']) {
    expect(out).not.toContain(name)
  }
})

test('mangleProperties covers method variants, patterns, and super accesses together', () => {
  const input = `var source = {
  value_: 2,
  get doubled_() { return this.value_ * 2; },
  set doubled_(next) { this.value_ = next / 2; },
  async async_() { return this.value_; },
  *generator_() { yield this.doubled_; }
};
class Base { method_() { return 3; } }
class Derived extends Base {
  field_ = source.value_;
  method_() { return super.method_() + this.field_; }
}
var { value_: value, doubled_: doubled, ...rest } = source;
function read({ value_: parameter = 0 }) { return parameter; }
log(value, doubled, rest.generator_().next().value, new Derived().method_(), read(source));`
  const out = transform(input, {
    builtins: true,
    nameGenerator: sequentialName,
    regex: /_$/,
  })
  expect(trace(out)).toEqual(trace(input))
  for (const name of ['value_', 'doubled_', 'async_', 'generator_', 'field_', 'method_']) {
    expect(out).not.toContain(name)
  }
})

test('mangleProperties preserves behavior across the option and quoting matrix', () => {
  const input = `var plain = { plain_: 1 };
var quoted = { "quoted_": 2 };
var computed = { ["computed_"]: 3 };
var annotated = { /*@__MANGLE_PROP__*/ annotated_: 4 };
var reserved = { reserved_: 5 };
var publicObject = { public: 6 };
var choose = true;
var branches = { ["left_"]: 7, ["right_"]: 8 };
log(plain.plain_, quoted["quoted_"], computed["computed_"], annotated.annotated_, reserved.reserved_, publicObject.public, branches[choose ? "left_" : "right_"]);
choose = false;
log(branches[choose ? "left_" : "right_"]);`

  for (const keepQuoted of [false, true, 'strict'] as const) {
    for (const regex of [undefined, /_$/]) {
      for (const onlyAnnotated of [false, true]) {
        for (const reserveName of [false, true]) {
          for (const debug of [false, 'TEST']) {
            const out = transform(input, {
              builtins: true,
              debug,
              keepQuoted,
              nameGenerator: sequentialName,
              onlyAnnotated,
              reserved: reserveName ? ['reserved_'] : [],
              ...(regex === undefined ? {} : { regex }),
            })
            expect(trace(out)).toEqual(trace(input))
          }
        }
      }
    }
  }
})

test('mangleProperties never changes class constructor syntax or an object prototype setter', () => {
  const input = `var parent = { inherited: 9 };
var object = { __proto__: parent };
class Box { constructor() { this.value = object.inherited; } }
log(new Box().value, Object.getPrototypeOf(object) === parent);`
  const out = transform(input, { builtins: true, nameGenerator: sequentialName })
  expect(trace(out)).toEqual(trace(input))
  expect(out).toMatch(/constructor\(\)/)
  expect(out).toMatch(/__proto__:\s*parent/)
})

test('mangleProperties leaves private class names untouched', () => {
  const input = `class Box { #secret = 7; read() { return this.#secret; } } log(new Box().read());`
  const out = transform(input, {
    builtins: true,
    nameGenerator: () => 'renamed',
    regex: /secret/,
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).toContain('#secret')
  expect(out).not.toContain('#renamed')
})

test('mangleProperties regex accepts both a RegExp and a pattern string', () => {
  const input = `var object = { public: 1, private_: 2 }; log(object.public, object.private_);`
  for (const regex of [/_$/, '_$']) {
    const out = transform(input, { builtins: true, nameGenerator: () => 'renamed', regex })
    expect(trace(out)).toEqual(trace(input))
    expect(out).toContain('public')
    expect(out).not.toContain('private_')
  }
})

test('mangleProperties resets stateful regular expressions before every match', () => {
  const input = `var object = { first_: 1, second_: 2 }; log(object.first_ + object.second_);`
  const out = transform(input, {
    builtins: true,
    nameGenerator: sequentialName,
    regex: /_$/g,
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).not.toContain('first_')
  expect(out).not.toContain('second_')
})

test('mangleProperties reserved names form the exclusion list', () => {
  const input = `var object = { keep_: 1, change_: 2 }; log(object.keep_, object.change_);`
  const out = transform(input, {
    builtins: true,
    nameGenerator: () => 'renamed',
    regex: /_$/,
    reserved: ['keep_'],
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).toContain('keep_')
  expect(out).not.toContain('change_')
})

test('mangleProperties protects JavaScript and DOM builtin names by default', () => {
  const input = `var object = { map: 1, addEventListener: 2, private_: 3 };
log(object.map, object.addEventListener, object.private_);`
  const out = transform(input, { nameGenerator: sequentialName })
  expect(trace(out)).toEqual(trace(input))
  expect(out).toContain('map')
  expect(out).toContain('addEventListener')
  expect(out).not.toContain('private_')
})

test('mangleProperties builtins allows builtin-shaped own properties to be renamed', () => {
  const input = `var object = { map: 1 }; log(object.map);`
  const out = transform(input, {
    builtins: true,
    nameGenerator: () => 'renamed',
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).not.toContain('map')
})

test('mangleProperties keepQuoted false mangles quoted and unquoted occurrences together', () => {
  const input = `var object = { "secret_": 6 }; log(object.secret_, object["secret_"]);`
  const out = transform(input, {
    builtins: true,
    keepQuoted: false,
    nameGenerator: () => 'renamed',
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).not.toContain('secret_')
})

test('mangleProperties keepQuoted true reserves a quoted name everywhere', () => {
  const input = `var first = { secret_: 1 }; var second = { "secret_": 2 };
log(first.secret_, second["secret_"]);`
  const out = transform(input, {
    builtins: true,
    keepQuoted: true,
    nameGenerator: () => 'renamed',
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).toContain('secret_')
  expect(out).not.toContain('renamed')
})

test('mangleProperties keepQuoted true reserves statically computed quoted names', () => {
  const input = `const key = "secret_";
var object = { secret_: 1, [key]: 2 };
log(object.secret_, object[key]);`
  const out = transform(input, {
    builtins: true,
    keepQuoted: true,
    nameGenerator: () => 'renamed',
    regex: /_$/,
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).not.toContain('renamed')
})

test("mangleProperties keepQuoted 'strict' mangles unquoted occurrences but leaves quoted ones", () => {
  const input = `var first = { secret_: 1 }; var second = { "secret_": 2 };
log(first.secret_, second["secret_"]);`
  const out = transform(input, {
    builtins: true,
    keepQuoted: 'strict',
    nameGenerator: () => 'renamed',
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).toContain('"secret_"')
  expect(out).toContain('renamed')
})

test("mangleProperties keepQuoted 'strict' does not emit a quoted name", () => {
  const generated = ['quoted_', 'renamed']
  const input = `var object = { "quoted_": 1, secret_: 2 };
log(object["quoted_"], object.secret_);`
  const out = transform(input, {
    builtins: true,
    keepQuoted: 'strict',
    nameGenerator: (index) => generated[index]!,
    regex: /_$/,
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).toContain('"quoted_"')
  expect(out).toContain('renamed')
})

test('mangleProperties uses the custom name generator with zero-based ordinals', () => {
  const indexes: number[] = []
  const out = transform(`var object = { first_: 1, second_: 2 };`, {
    builtins: true,
    nameGenerator(index) {
      indexes.push(index)
      return `custom${index}`
    },
  })
  expect(indexes).toEqual([0, 1])
  expect(out).toContain('custom0')
  expect(out).toContain('custom1')
})

test('mangleProperties emits arbitrary nonnumeric string property names safely', () => {
  for (const generated of ['', 'not-an-identifier', 'default', 'quote"', 'line\nbreak', '💩']) {
    const input = `var object = { secret_: 3 }; log(object.secret_);`
    const out = transform(input, {
      builtins: true,
      nameGenerator: () => generated,
      regex: /_$/,
    })
    expect(trace(out)).toEqual(trace(input))
    expect(out).not.toContain('secret_')
  }
})

test('mangleProperties preserves a long generated rename chain through source names', () => {
  const names = Array.from({ length: 256 }, (_, index) => `property_${index}_`)
  const input = propertyFamilyProgram(names)
  const out = transform(input, {
    builtins: true,
    nameGenerator: (index) => names[index + 1] ?? 'final',
    regex: /_$/,
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).toContain('final')
})

test('mangleProperties makes generated names skip reserved and unmangleable properties', () => {
  const generated = ['reserved', 'visible', 'renamed']
  const input = `var object = { visible: 1, secret_: 2 }; log(object.visible, object.secret_);`
  const out = transform(input, {
    builtins: true,
    nameGenerator: (index) => generated[index]!,
    regex: /_$/,
    reserved: ['reserved'],
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).toContain('visible')
  expect(out).toContain('renamed')
})

test('mangleProperties skips generated names with special object or class syntax', () => {
  const generated = ['__proto__', 'constructor', 'prototype', 'renamed']
  const input = `class Box { secret_() { return 4; } } log(new Box().secret_());`
  const out = transform(input, {
    builtins: true,
    nameGenerator: (index) => generated[index]!,
    regex: /_$/,
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).toContain('renamed')
  expect(out).not.toContain('secret_')
})

test('mangleProperties rejects a custom name generator that returns a non-string', () => {
  const ast = parse(`var object = { secret_: 1 };`, { sourceType: 'unambiguous' })
  const invalid = (() => 1) as unknown as (index: number) => string
  expect(() =>
    mangleProperties(ast, {
      ...BASE_CONTEXT,
      mangleProperties: { builtins: true, nameGenerator: invalid },
    }),
  ).toThrow(/must return a string/)
})

test('mangleProperties reuses and extends a caller-owned cache', () => {
  const cache = new Map([['first_', 'cached']])
  const input = `var object = { first_: 1, second_: 2 }; log(object.first_, object.second_);`
  const out = transform(input, {
    builtins: true,
    cache,
    nameGenerator: () => 'generated',
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).toContain('cached')
  expect(out).toContain('generated')
  expect(cache.get('second_')).toBe('generated')
})

test('mangleProperties remangles a source property that collides with a cached output', () => {
  const cache = new Map([['secret_', 'cached']])
  const input = `var object = { cached: 1, secret_: 2 };
log(object.cached, object.secret_);`
  const out = transform(input, {
    builtins: true,
    cache,
    nameGenerator: () => 'generated',
  })
  expect(trace(out)).toEqual(trace(input))
  expect(cache.get('cached')).toBe('generated')
})

test('mangleProperties leaves a cached mapping unused when its output must stay unchanged', () => {
  const cache = new Map([['secret_', 'quoted_']])
  const input = `var object = { "quoted_": 1, secret_: 2 };
log(object["quoted_"], object.secret_);`
  const out = transform(input, {
    builtins: true,
    cache,
    keepQuoted: 'strict',
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).toContain('secret_')
})

test('mangleProperties resolves cascading cached-output collisions without merging keys', () => {
  const cache = new Map([
    ['first_', 'second_'],
    ['second_', 'kept'],
  ])
  const input = `var object = { first_: 1, second_: 2, kept: 3 };
log(object.first_, object.second_, object.kept);`
  const out = transform(input, {
    builtins: true,
    cache,
    reserved: ['kept'],
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).toContain('first_')
  expect(out).toContain('second_')
})

test('mangleProperties applies a collision-free cached cycle simultaneously', () => {
  const cache = new Map([
    ['first_', 'second_'],
    ['second_', 'first_'],
  ])
  const input = `var object = { first_: 1, second_: 2 };
log(object.first_, object.second_);`
  const out = transform(input, { builtins: true, cache })
  expect(trace(out)).toEqual(trace(input))
  expect(out).not.toBe(run(input, () => {}))
})

test('mangleProperties propagates a retained endpoint through a long cached chain', () => {
  const names = Array.from({ length: 256 }, (_, index) => `property_${index}_`)
  const cache = new Map(names.slice(0, -1).map((name, index) => [name, names[index + 1]!] as const))
  const input = propertyFamilyProgram(names)
  const out = transform(input, {
    builtins: true,
    cache,
    reserved: [names.at(-1)!],
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).toBe(run(input, () => {}))
})

test('mangleProperties rejects cache entries that would collide or change property syntax', () => {
  const duplicate = new Map([
    ['first_', 'same'],
    ['second_', 'same'],
  ])
  expect(() =>
    transform(`var object = { first_: 1, second_: 2 };`, {
      builtins: true,
      cache: duplicate,
    }),
  ).toThrow(/duplicate output/)

  expect(() =>
    transform(`var object = { first_: 1 };`, {
      builtins: true,
      cache: new Map([['first_', '__proto__']]),
    }),
  ).toThrow(/cannot emit/)
})

test('mangleProperties onlyCache treats the cache as its inclusion list', () => {
  const cache = new Map([['first_', 'cached']])
  const input = `var object = { first_: 1, second_: 2 }; log(object.first_, object.second_);`
  const out = transform(input, {
    builtins: true,
    cache,
    nameGenerator: () => 'unused',
    onlyCache: true,
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).toContain('cached')
  expect(out).toContain('second_')
  expect(cache.has('second_')).toBe(false)
})

test('mangleProperties debug retains the source name and optional suffix', () => {
  const input = `var object = { secret_: 1 }; log(object.secret_);`
  const plain = transform(input, { builtins: true, debug: true })
  const suffixed = transform(input, { builtins: true, debug: 'DEV' })
  expect(trace(plain)).toEqual(trace(input))
  expect(trace(suffixed)).toEqual(trace(input))
  expect(plain).toContain('_$secret_$_')
  expect(suffixed).toContain('_$secret_$DEV_')
})

test('mangleProperties onlyAnnotated mangles a property family marked on one definition', () => {
  const input = `var object = {
  /*@__MANGLE_PROP__*/ secret_: 1,
  visible_: 2
};
log(object.secret_, object.visible_);`
  const out = transform(input, {
    builtins: true,
    nameGenerator: () => 'renamed',
    onlyAnnotated: true,
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).not.toContain('secret_')
  expect(out).toContain('visible_')
})

test('mangleProperties recognizes annotations on statically evaluable computed keys', () => {
  const input = `var object = { [/*@__MANGLE_PROP__*/ \`secret_\`]: 7 };
log(object.secret_);`
  const out = transform(input, {
    builtins: true,
    nameGenerator: () => 'renamed',
    onlyAnnotated: true,
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).not.toContain('secret_')
})

test('mangleProperties annotation overrides a nonmatching regex but not reserved names', () => {
  const input = `var object = {
  /*@__MANGLE_PROP__*/ annotated: 1,
  /*@__MANGLE_PROP__*/ kept: 2,
  matching_: 3
};
log(object.annotated, object.kept, object.matching_);`
  const out = transform(input, {
    builtins: true,
    nameGenerator: sequentialName,
    regex: /_$/,
    reserved: ['kept'],
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).not.toContain('annotated')
  expect(out).toContain('kept')
  expect(out).not.toContain('matching_')
})

test('mangleProperties recognizes an annotation on an outer member expression', () => {
  const input = `var object = { keep: { secret_: 4 } };
/*@__MANGLE_PROP__*/ object.keep.secret_ = object.keep.secret_ + 1;
log(object.keep.secret_);`
  const out = transform(input, {
    builtins: true,
    nameGenerator: () => 'renamed',
    onlyAnnotated: true,
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).toContain('keep')
  expect(out).not.toContain('secret_')
})

test('mangleProperties accepts hash-prefixed property and key annotations', () => {
  const input = `function lookup(object, key) { return object[key]; }
var object = { /*#__MANGLE_PROP__*/ secret_: 8 };
log(lookup(object, /*#__KEY__*/ "secret_"));`
  const out = transform(input, {
    builtins: true,
    nameGenerator: () => 'renamed',
    onlyAnnotated: true,
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).not.toContain('secret_')
})

test('mangleProperties rewrites strings marked with @__KEY__ in arbitrary expressions', () => {
  const input = `function lookup(object, key) { return object[key]; }
var object = { /*@__MANGLE_PROP__*/ secret_: 8 };
log(lookup(object, /*@__KEY__*/ "secret_"));`
  const out = transform(input, {
    builtins: true,
    nameGenerator: () => 'renamed',
    onlyAnnotated: true,
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).not.toContain('secret_')
})

test('mangleProperties does not mangle an annotated key twice when its output is another source name', () => {
  const input = `function lookup(object, key) { return object[key]; }
var object = { first_: 8, second_: 9 };
log(lookup(object, /*@__KEY__*/ "first_"), lookup(object, /*@__KEY__*/ "second_"));`
  const generated = ['second_', 'renamed']
  const out = transform(input, {
    builtins: true,
    nameGenerator: (index) => generated[index]!,
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).not.toContain('first_')
})

test('mangleProperties skips undeclared-root member properties by default', () => {
  for (const input of [
    'External.secret_;',
    'External().secret_;',
    'External?.().secret_;',
    'new External().secret_;',
    'External?.secret_;',
    'External.factory().secret_;',
    'External``.secret_;',
  ]) {
    const out = transform(input, {
      builtins: true,
      nameGenerator: () => 'renamed',
      regex: /_$/,
    })
    expect(out).toContain('secret_')
    expect(out).not.toContain('renamed')
  }
})

test('mangleProperties does not emit a property skipped on an undeclared root', () => {
  const generated = ['external_', 'renamed']
  const input = `globalThis.External = {};
External.external_ = 1;
var local = External;
local.secret_ = 2;
log(External.external_, local.secret_);
delete globalThis.External;`
  const out = transform(input, {
    builtins: true,
    nameGenerator: (index) => generated[index]!,
    regex: /_$/,
  })
  expect(trace(out)).toEqual(trace(input))
  expect(out).toContain('external_')
  expect(out).toContain('renamed')
})

test('mangleProperties undeclared includes undeclared-root member properties', () => {
  for (const input of [
    'External.secret_;',
    'External().secret_;',
    'External?.().secret_;',
    'new External().secret_;',
    'External?.secret_;',
    'External.factory().secret_;',
    'External``.secret_;',
  ]) {
    const out = transform(input, {
      builtins: true,
      nameGenerator: () => 'renamed',
      regex: /_$/,
      undeclared: true,
    })
    expect(out).not.toContain('secret_')
    expect(out).toContain('renamed')
  }
})

test('mangleProperties follows Terser by treating bracket strings as candidates regardless of the root binding', () => {
  const input = `External["secret_"];`
  const out = transform(input, {
    builtins: true,
    nameGenerator: () => 'renamed',
    regex: /_$/,
  })
  expect(out).not.toContain('secret_')
  expect(out).toContain('renamed')
})

test('mangleProperties uses the configured StringGenerator when no custom generator is supplied', () => {
  const input = `var object = { secret_: 1 }; log(object.secret_);`
  const out = run(input, apply({ builtins: true }, { seed: 0, stringGeneratorMode: 'number' }))
  expect(trace(out)).toEqual(trace(input))
  expect(out).toContain('var_1')
})

test('mangleProperties reports whether it changed the AST', () => {
  const unchanged = parse(`var key = read(); object[key];`, { sourceType: 'unambiguous' })
  const changed = parse(`var object = { secret_: 1 };`, { sourceType: 'unambiguous' })
  expect(
    mangleProperties(unchanged, {
      ...BASE_CONTEXT,
      mangleProperties: { builtins: true, nameGenerator: sequentialName },
    }),
  ).toBe(false)
  expect(
    mangleProperties(changed, {
      ...BASE_CONTEXT,
      mangleProperties: { builtins: true, nameGenerator: sequentialName },
    }),
  ).toBe(true)
})
