# webfuscator

`webfuscator` is a Babel-based JavaScript obfuscator. It parses a JavaScript source string, applies configurable transforms, and returns JavaScript source.

[Read the documentation](./docs/index.mdx) for the quickstart, configuration guides, API details, and a reference page for every transform.

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

- [Quickstart](./docs/getting-started/quickstart.mdx)
- [JavaScript API](./docs/reference/api.mdx)
- [Configure transforms](./docs/guides/configure-transforms.mdx)
- [Obfuscator options](./docs/reference/options.mdx)
- [Property mangling](./docs/reference/property-mangling-options.mdx)
- [String generator modes](./docs/reference/string-generator-modes.mdx)
- [Report a bug](./docs/troubleshooting/report-a-bug.mdx)

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
