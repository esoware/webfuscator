# webfuscator

`webfuscator` is a Babel-based JavaScript obfuscator. `obfuscate(code, options)` parses source, always runs preparation, runs only explicitly enabled transforms, and generates formatted JavaScript unless `minify` is enabled.

Published packages live in `packages/`, so the npm package is `packages/webfuscator/`. Everything that deploys without being published lives in `apps/`: the documentation site in `apps/docs/` and the playground in `apps/playground/`. Each workspace owns the commands it runs, and the root delegates to every one. The repository root holds configuration and no source.

## Behavior contracts

Every pass honors one of these four contracts. Most honor the first. A pass that wants another must justify why the first is physically impossible, not merely inconvenient.

1. **Behavior-preserving.** The default. For every legal JavaScript program the rewrite either preserves observable behavior exactly or does not happen. If a pass cannot prove a rewrite safe, it leaves the code alone. A missed rewrite is fine. A rewrite that changes behavior is a bug. Stripped comments are the only preserved-behavior exception; `shouldPrintComment` in `packages/webfuscator/src/obfuscator.ts` lists the comments that survive.
2. **Effect-removing.** The pass exists to delete one named observable effect and preserve everything else. It removes only that effect and bails when it cannot isolate it. `dropConsole` and `dropDebugger` are the only two. Off by default.
3. **Boundary-dependent.** Correctness depends on a fact outside the input that the AST cannot show, so the pass cannot prove the rewrite safe on its own. It refuses every hazard it can see and gives the caller the controls to scope the rest. The caller owns the boundary promise. `mangleProperties` is the only one. Off by default.
4. **Opt-in behavior change.** An off-by-default option that deliberately changes semantics when set. The default preserves behavior; the option documents the change. `pack`'s `escapeStrict` is the only one.

One rule holds across all four. A pass never silently changes observable behavior. It proves a rewrite safe and applies it, proves it unsafe and declines, or is an off-by-default feature whose named change the caller chose.

Throwing is for invalid caller configuration and for the one construct `pack` cannot represent. `mangleProperties` throws on a malformed `cache` or `nameGenerator`, `StringGenerator` on an empty mode list, and `pack` on a program that uses `export` statements, which cannot exist inside a `Function` body. Otherwise a hard case is a skip, not an exception.

## Commands

Every task runs from the root. A workspace script is the real command, a root script is a one-line delegation. Add the command where it runs, then expose it from the root.

- `pnpm test` runs the full suite. Run it after every meaningful change.
- `pnpm check` runs the typecheck, lint, format check, knip, generated-docs check, and tests. It must pass before the task is done.
- `pnpm docs:check` validates links, snippets, redirects, and accessibility. It needs the network, so it stays out of `pnpm check`.
- `pnpm dev` and `pnpm preview` serve the playground, `pnpm docs:dev` the docs. `pnpm build`, `pnpm typecheck`, and `pnpm test:watch` cover the rest.
- The deploy script is `deploy:playground`, not `deploy`, because `pnpm deploy` is a built-in pnpm command that never reaches a script by that name.

## Tooling

Use pnpm for installs and scripts. Tests use `vitest`. AST work uses `@babel/parser`, `@babel/traverse`, `@babel/types`, and `@babel/generator`. `oxlint` and `oxfmt` handle linting and formatting. Do not add npm, yarn, bun, Jest, `node:test`, SWC, Acorn, ESLint, or Prettier. None is installed.

Keep `knip` at zero. Delete dead code instead of exporting it.

`packages/webfuscator/vitest.config.ts` raises the worker stack with `--stack-size`. The deep-nesting tests need the larger stack because `@babel/parser` exhausts Node's default while parsing them.

`build` removes `packages/webfuscator/dist` through Node's filesystem API so the script works in both Windows and POSIX shells. It then compiles, runs `tsc-alias`, and runs `packages/webfuscator/scripts/verify-dist.mjs`. Keep all three. `tsc` copies relative specifiers into its output unchanged, `tsc-alias` adds the extensions Node needs, and the verifier imports the built entry point and fails the build if any specifier is still extensionless. Nothing else reads `dist`, so dropping the verifier is how a broken build reaches npm.

## Pipeline and transforms

The phase tables in `packages/webfuscator/src/obfuscator.ts` define which passes run and in what order. Their comments explain every ordering constraint. When you add, move, or reorder a pass, update the tables and those comments. Do not record pipeline order anywhere else.

- Synthesize every identifier and label with `scope.generateUid('purpose')` on the owning scope. No transform carries its own counter or prefix scheme.
- Track changes through `traverseForChanges` and `ChangeState` in `packages/webfuscator/src/utils/change-tracking.ts`. A pass with its own traversal loop keeps state in an object that extends `ChangeState`.
- Give every new pass in `packages/webfuscator/src/transforms/` or `packages/webfuscator/src/preparation/` a mirror test at the same path under `packages/webfuscator/tests/`. If the pass is configurable, add it to `TransformName` in `packages/webfuscator/src/options.ts`.
- Default a new configurable pass to the behavior-preserving contract. A pass on any other contract needs the justification above, an off-by-default toggle, and a caveat callout in `apps/docs/scripts/generate-transforms.mjs` so its page flags the change.
- Most helpers in `packages/webfuscator/src/utils/` and `packages/webfuscator/src/analysis/` get coverage from their transforms. The rewrite safety predicates in `packages/webfuscator/src/analysis/purity.ts`, `packages/webfuscator/src/analysis/constant.ts`, and `packages/webfuscator/src/analysis/document-order.ts` need direct mirror tests. So do the value builders in `packages/webfuscator/src/utils/literal.ts` and `packages/webfuscator/src/utils/string-generator.ts`. Transitive tests miss too many of their branches, and a wrong answer can change program behavior.
- `packages/webfuscator/src/index.ts` exports the public API and nothing else.

## Code style

- Let names carry the explanation. If a function needs a comment to say what it does, rename it. Prefer `combineConstants()` to `compute()`.
- Give each function one job. Split the function instead of adding a flag that switches between behaviors.
- Validate at the boundaries, then trust the types. Parser output and `ObfuscatorOptions` are the boundaries. Inside them, do not add null guards for non-null parameters, `try`/`catch` around code that cannot throw, or `instanceof` checks where TypeScript has already narrowed the value.
- Wait for a second real caller before extracting a helper. Three similar lines are better than an abstraction with one use.
- Put shared AST and path predicates in `packages/webfuscator/src/utils/`. Put shared evaluation logic in `packages/webfuscator/src/analysis/`. Import from those modules, never from one transform into another.
- Prefer Babel's typed walkers. Use `traverse` with a typed `Visitor` and `path.isFoo()` when you need scope. Use `t.traverseFast` when you need to skip subtrees or short-circuit without traversal overhead. Use manual recursion only as a last resort.
- Separate imports into `node:*`, third-party, and first-party groups, in that order. Sort each group alphabetically. `vitest` belongs in the third-party group.
- Put a value import before its matching `import type`. Keep `type` out of named specifier lists. Use native relative paths for all intra-package imports; no path aliases anywhere in the repository.

## Comments

Comments explain why, not what. Delete any comment that a reader familiar with JavaScript and Babel could infer from the code. Good reasons for a comment include a TDZ rule, an ECMA-262 reference, a Babel scope-table quirk, an aliasing risk that TypeScript cannot catch, or a deliberate fallthrough that a later pass needs.

Use ASCII punctuation in comments: `-`, `->`, `...`, and straight quotes. The `@example` banner markers are the only exception. Prefer a single line. In a multi-line `//` block, capitalize the first line and let the rest read as continuous prose. Do not leave commented-out code, `// TODO`, `// FIXME`, type-signature restatements, values that will go stale, or change history. Git holds the history.

## Tests and examples

- Prove behavior. Output shape is not enough. Parse, transform, generate, evaluate with `new Function`, and compare the observable result with the original. Assertions such as `toContain` and `toMatch` may pin a specific rewrite after that comparison. Alone, they prove nothing about behavior.
- Direct predicate tests in `packages/webfuscator/tests/analysis/` and `packages/webfuscator/tests/utils/` should cover a range of inputs, with extra weight on cases the helper must refuse. An over-eager `true` can break observational equivalence.
- Fix the code, not the test. If an assertion is wrong, replace it with a stronger one and explain why in the commit message.
- Every entry point in `packages/webfuscator/src/transforms/` and `packages/webfuscator/src/preparation/` needs an `@example` that demonstrates real behavior. Match the fixtures: `// ◀️ before`, the input, a blank line, `// ▶️ after`, then the output.
- `defineCases` in `packages/webfuscator/tests/helpers.ts` writes `packages/webfuscator/tests/fixtures/output/<name>.js` during a test run. Use those files to inspect each transform's isolated output.
