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

Configurable transforms are disabled by default; preparation passes always run.

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

```sh
pnpm install
pnpm test
pnpm check
pnpm docs:check
```

Read [AGENTS.md](./AGENTS.md) before changing transforms or analysis code.

## Responsible use

Use `webfuscator` only on software you own or are authorized to modify. Read [DISCLOSURE](./DISCLOSURE) for the project's dual-use policy.

## License

[MIT](./LICENSE)
