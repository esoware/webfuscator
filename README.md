`webfuscator` is a Babel-based JavaScript obfuscator. It parses a JavaScript source string, applies configurable transforms, and returns JavaScript source.

[Read the documentation](https://docs.webfuscator.dev) for the quickstart, configuration guides, API details, and a reference page for every transform. To try it without installing anything, open the [playground](https://playground.webfuscator.dev) and obfuscate a file in your browser.

## Install

```sh
npm install --save-dev webfuscator
```

The package is ESM-only, includes TypeScript declarations, and requires Node.js `^22.18.0 || >=24.11.0`.

## Usage

```js
import { obfuscate } from 'webfuscator'

const source = `export default function square(value) {
  return value * value
}`

const output = obfuscate(source, {
  minify: true,
  seed: 0,
  transforms: {
    renameIdentifiers: true,
  },
})
```

`obfuscate(code, options?)` is synchronous. It does not execute the input or write files.

`obfuscate` always runs internal preparation. A configurable transform runs only when its
`options.transforms` entry is `true`; transforms with settings also accept an options object.
Omitting the map runs none of them. Defaults for formatting, logging, seeds, and generated-name
styles do not cause a transform to run.

## Documentation

- [Playground](https://playground.webfuscator.dev)
- [Quickstart](https://docs.webfuscator.dev/getting-started/quickstart)
- [JavaScript API](https://docs.webfuscator.dev/reference/api)
- [Configure transforms](https://docs.webfuscator.dev/guides/configure-transforms)
- [Obfuscator options](https://docs.webfuscator.dev/reference/options)
- [Property mangling](https://docs.webfuscator.dev/reference/property-mangling-options)
- [String generator modes](https://docs.webfuscator.dev/reference/string-generator-modes)
- [Report a bug](https://docs.webfuscator.dev/troubleshooting/report-a-bug)

## Development

Every task runs from the repository root.

```sh
pnpm install
pnpm dev          # playground at localhost:5173
pnpm docs:dev     # documentation site
pnpm test         # the full suite
pnpm check        # typecheck, lint, format, knip, generated docs, tests
pnpm docs:check   # links, snippets, redirects, accessibility
```

[AGENTS.md](https://github.com/esoware/webfuscator/blob/main/AGENTS.md) lists the rest and explains which workspace owns what. Read it before changing transforms or analysis code.

## Contributing

Pull requests are welcome.

## Responsible use

Use `webfuscator` only on software you own or are authorized to modify. Read [DISCLOSURE](https://github.com/esoware/webfuscator/blob/main/DISCLOSURE) for the project's dual-use policy.

## License

[MIT](https://github.com/esoware/webfuscator/blob/main/LICENSE)
