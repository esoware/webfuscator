# webfuscator

`webfuscator` is a Babel-based JavaScript obfuscator. It parses source code, applies an ordered transform pipeline, and returns JavaScript.

## Features

- Renames variables, functions, and labels
- Mangles selected property names
- Inlines functions and folds constants
- Rewrites loops, conditionals, and switch statements
- Turns numbers and other literals into string-based expressions
- Removes dead code
- Generates short, hexadecimal, random, keyword-like, or numbered names
- Seeds built-in randomization for reproducible output

## Install

```sh
npm install webfuscator
```

## Usage

```js
import { obfuscate } from 'webfuscator'

const source = `
function greet(name) {
  console.log('Hello, ' + name)
}

greet('world')
`

const code = obfuscate(source, {
  stringGeneratorMode: 'mangled', // Other modes: hexadecimal, randomized, zeroWidth, number
  seed: 0,
  transforms: { dropConsole: false }, // Disable individual transforms by name
})
```

`obfuscate(code, options?)` takes source code as a string and returns transformed source code. The package includes TypeScript declarations, requires Node.js `^22.18.0 || >=24.11.0`, and supports ESM only.

### Property mangling

Property mangling is off by default. The transform cannot find property uses
outside its input, so unrestricted mangling can break callers. Use `regex` to
limit mangling to private application properties, such as names ending in `_`:

```js
const propertyCache = new Map()

const code = obfuscate(source, {
  transforms: {
    mangleProperties: {
      regex: /_$/,
      reserved: ['public_api_'],
      cache: propertyCache,
    },
  },
})
```

The options match Terser's property mangler, with camel-case names:

- `regex` selects property names. `reserved` excludes names from that selection.
- `builtins` defaults to `false`, which protects Terser's JavaScript and DOM
  property set. Setting it to `true` may rename runtime or browser APIs.
- `cache` is a mutable `Map<string, string>` that reuses mappings across separate
  inputs. `onlyCache` limits mangling to keys already in that map.
- `nameGenerator(index)` receives a zero-based ordinal and returns the next name.
  Without it, the transform uses its own `stringGeneratorMode` or the top-level
  mode.
- `debug: true` emits names in the form `_$source$_`. A string value becomes the
  suffix.
- `keepQuoted: true` reserves quoted property names everywhere. `'strict'` keeps
  quoted occurrences unchanged but allows unquoted occurrences of the same name
  to be mangled.
- `onlyAnnotated` limits mangling to names marked with
  `/*@__MANGLE_PROP__*/`. `/*@__KEY__*/` marks a string literal as a use of the
  selected property name. Either annotation may use `#` instead of `@`.
- `undeclared` includes unquoted member accesses rooted at identifiers that are
  not declared in the input. Bracket-string accesses are considered either way.

## Issues and pull requests

Both are open. For bugs, include the input and options you used.

## License

[MIT](./LICENSE)
