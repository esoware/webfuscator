import traverse from '@babel/traverse'
import type { NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import type { ConcealStringsOptions, TransformContext } from '../options'
import { isNonComputedKey } from '../utils/ast'
import type { ChangeState } from '../utils/change-tracking'
import { mulberry32, shuffleInPlace } from '../utils/random'

const RECORD_WIDTH = 4

/**
 * Replaces runtime string literals with calls to a generated decoder backed by
 * an obfuscated string vault.
 *
 * @example
 * // ◀️ before
 * function greet(name) {
 *   return "Hello, " + name;
 * }
 *
 * // ▶️ after
 * const _stringPool = " lo,He",
 *   _stringPayload = [0, 4, 7, 2, 2, 6, 2],
 *   _stringMetadata = [0, 7, 4, 5],
 *   _stringCache = [null],
 *   _stringDecoder = function (_entry) {
 *     let _cached = _stringCache[_entry];
 *     if (_cached !== null) return _cached;
 *     let _result = "",
 *       _record = _entry * 4,
 *       _start = _stringMetadata[_record],
 *       _length = _stringMetadata[_record + 1],
 *       _stringKey = _stringMetadata[_record + 2],
 *       _stringStep = _stringMetadata[_record + 3];
 *     for (let _position = 0; _position < _length; _position++) {
 *       let _stringMask = _stringKey + _position * _stringStep & 7;
 *       _result += _stringPool[_stringPayload[_start + _position] ^ _stringMask];
 *     }
 *     _stringCache[_entry] = _result;
 *     return _result;
 *   };
 * function greet(name) {
 *   return _stringDecoder(0) + name;
 * }
 */
export function concealStrings(ast: File, ctx: TransformContext): boolean {
  const options = resolveOptions(ctx.concealStrings)
  const rng = mulberry32(ctx.seed)
  const state: State = { changed: false, groups: new Map(), options }

  if (options.scope === 'function') {
    normalizeConciseArrows(ast, options)
  }

  traverse(ast, collectVisitor, undefined, state)
  if (state.groups.size === 0) {
    return false
  }
  const pool = buildSharedPool(state.groups.values(), options.cover, rng)
  for (const group of state.groups.values()) {
    concealGroup(group, options, pool, rng)
    state.changed = true
  }
  return state.changed
}

interface ResolvedOptions {
  cache: boolean
  cover: 'full' | 'regional' | 'used'
  deduplicate: boolean
  scope: 'function' | 'program'
}

type VaultOwner = t.Program | t.Function
type VaultOwnerPath = NodePath<VaultOwner>

interface Occurrence {
  path: NodePath<t.StringLiteral>
  value: string
}

interface VaultGroup {
  occurrences: Occurrence[]
  owner: VaultOwnerPath
}

interface State extends ChangeState {
  groups: Map<VaultOwner, VaultGroup>
  options: ResolvedOptions
}

interface Entry {
  occurrences: Occurrence[]
  value: string
}

interface VaultData {
  indexMask: number
  metadata: number[]
  payload: number[]
  pool: string
}

interface SharedPool {
  indexMask: number
  positions: ReadonlyMap<string, number>
  value: string
}

interface VaultIdentifiers {
  cache: t.Identifier | null
  decoder: t.Identifier
  metadata: t.Identifier
  payload: t.Identifier
  pool: t.Identifier
}

const collectVisitor: Visitor<State> = {
  StringLiteral(path, state) {
    if (!isRuntimeString(path)) {
      return
    }
    const owner = findVaultOwner(path, state.options.scope)
    if (!owner) {
      return
    }
    let group = state.groups.get(owner.node)
    if (!group) {
      group = { occurrences: [], owner }
      state.groups.set(owner.node, group)
    }
    group.occurrences.push({ path, value: path.node.value })
  },
}

function resolveOptions(options: ConcealStringsOptions | undefined): ResolvedOptions {
  const cache = options?.cache ?? true
  const cover = options?.cover ?? 'regional'
  const deduplicate = options?.deduplicate ?? true
  const scope = options?.scope ?? 'program'
  if (typeof cache !== 'boolean') {
    throw new TypeError('concealStrings cache must be a boolean')
  }
  if (cover !== 'full' && cover !== 'regional' && cover !== 'used') {
    throw new TypeError("concealStrings cover must be 'full', 'regional', or 'used'")
  }
  if (typeof deduplicate !== 'boolean') {
    throw new TypeError('concealStrings deduplicate must be a boolean')
  }
  if (scope !== 'function' && scope !== 'program') {
    throw new TypeError("concealStrings scope must be 'function' or 'program'")
  }
  return { cache, cover, deduplicate, scope }
}

function normalizeConciseArrows(ast: File, options: ResolvedOptions): void {
  const marked = new WeakSet<t.ArrowFunctionExpression>()
  traverse(ast, {
    StringLiteral(path) {
      if (!isRuntimeString(path)) {
        return
      }
      const owner = findVaultOwner(path, options.scope)
      if (owner?.isArrowFunctionExpression() && !t.isBlockStatement(owner.node.body)) {
        marked.add(owner.node)
      }
    },
    ArrowFunctionExpression: {
      exit(path) {
        if (!marked.has(path.node) || t.isBlockStatement(path.node.body)) {
          return
        }
        const expression = path.node.body
        path.get('body').replaceWith(t.blockStatement([t.returnStatement(expression)]))
        path.node.expression = false
      },
    },
  })
}

function findVaultOwner(
  path: NodePath<t.StringLiteral>,
  scope: ResolvedOptions['scope'],
): VaultOwnerPath | null {
  let child: NodePath = path
  let current: NodePath | null = path.parentPath
  while (current) {
    if (current.isFunction() && child.key === 'body' && scope === 'function') {
      return current as VaultOwnerPath
    }
    if (current.isProgram()) {
      return current
    }
    child = current
    current = current.parentPath
  }
  return null
}

function isRuntimeString(path: NodePath<t.StringLiteral>): boolean {
  const parent = path.parent
  const node = path.node
  if (
    (t.isImportDeclaration(parent) && parent.source === node) ||
    (t.isExportNamedDeclaration(parent) && parent.source === node) ||
    (t.isExportAllDeclaration(parent) && parent.source === node) ||
    t.isImportAttribute(parent) ||
    (t.isImportSpecifier(parent) && parent.imported === node) ||
    (t.isExportSpecifier(parent) && parent.exported === node) ||
    (t.isExportNamespaceSpecifier(parent) && parent.exported === node)
  ) {
    return false
  }
  return !isNonComputedKey(path)
}

function concealGroup(
  group: VaultGroup,
  options: ResolvedOptions,
  pool: SharedPool,
  rng: () => number,
): void {
  const entries = makeEntries(group.occurrences, options.deduplicate)
  shuffleInPlace(entries, rng)
  const data = encodeEntries(entries, pool, rng)
  const identifiers = insertVault(statementBody(group.owner), entries.length, data, options.cache)

  for (let index = 0; index < entries.length; index++) {
    for (const occurrence of entries[index]!.occurrences) {
      occurrence.path.replaceWith(
        t.callExpression(t.identifier(identifiers.decoder.name), [t.numericLiteral(index)]),
      )
      occurrence.path.skip()
    }
  }
}

function makeEntries(occurrences: Occurrence[], deduplicate: boolean): Entry[] {
  if (!deduplicate) {
    return occurrences.map((occurrence) => ({ occurrences: [occurrence], value: occurrence.value }))
  }
  const byValue = new Map<string, Entry>()
  for (const occurrence of occurrences) {
    let entry = byValue.get(occurrence.value)
    if (!entry) {
      entry = { occurrences: [], value: occurrence.value }
      byValue.set(occurrence.value, entry)
    }
    entry.occurrences.push(occurrence)
  }
  return [...byValue.values()]
}

function buildSharedPool(
  groups: Iterable<VaultGroup>,
  cover: ResolvedOptions['cover'],
  rng: () => number,
): SharedPool {
  const usedUnits = new Set<string>()
  for (const group of groups) {
    for (const occurrence of group.occurrences) {
      let index = 0
      while (index < occurrence.value.length) {
        usedUnits.add(occurrence.value[index]!)
        index++
      }
    }
  }

  const poolUnits = makePoolUnits(usedUnits, cover)
  shuffleInPlace(poolUnits, rng)
  return {
    indexMask: coveringBitMask(poolUnits.length),
    positions: indexPoolPositions(poolUnits),
    value: poolUnits.join(''),
  }
}

function encodeEntries(entries: Entry[], pool: SharedPool, rng: () => number): VaultData {
  const metadata: number[] = []
  const payload: number[] = []

  for (const entry of entries) {
    const key = randomInteger(pool.indexMask + 1, rng)
    const step = randomOddInteger(pool.indexMask, rng)
    metadata.push(payload.length, entry.value.length, key, step)
    for (let position = 0; position < entry.value.length; position++) {
      const truePosition = pool.positions.get(entry.value[position]!)!
      payload.push(truePosition ^ maskPosition(position, key, step, pool.indexMask))
    }
  }
  return { indexMask: pool.indexMask, metadata, payload, pool: pool.value }
}

function makePoolUnits(usedUnits: ReadonlySet<string>, cover: ResolvedOptions['cover']): string[] {
  return cover === 'used' ? [...usedUnits] : coveredPageUnits(usedUnits, cover)
}

function coveredPageUnits(
  usedUnits: ReadonlySet<string>,
  cover: Exclude<ResolvedOptions['cover'], 'used'>,
): string[] {
  const pages = new Set<number>()
  if (cover === 'full') {
    for (let page = 0; page < 0x01_00; page++) {
      pages.add(page)
    }
  } else {
    pages.add(0)
    for (const unit of usedUnits) {
      pages.add(unit.codePointAt(0)! >>> 8)
    }
  }

  const units: string[] = []
  for (const page of pages) {
    const start = page << 8
    for (let offset = 0; offset < 0x01_00; offset++) {
      units.push(String.fromCodePoint(start + offset))
    }
  }
  return units
}

function indexPoolPositions(pool: readonly string[]): Map<string, number> {
  const positions = new Map<string, number>()
  for (let index = 0; index < pool.length; index++) {
    positions.set(pool[index]!, index)
  }
  return positions
}

function coveringBitMask(length: number): number {
  let mask = 0
  while (mask < length - 1) {
    mask = (mask << 1) | 1
  }
  return mask
}

function randomInteger(limit: number, rng: () => number): number {
  return limit === 0 ? 0 : Math.floor(rng() * limit)
}

function randomOddInteger(mask: number, rng: () => number): number {
  return mask === 0 ? 0 : randomInteger((mask + 1) / 2, rng) * 2 + 1
}

function maskPosition(position: number, key: number, step: number, indexMask: number): number {
  return (key + position * step) & indexMask
}

function statementBody(owner: VaultOwnerPath): NodePath<t.Program | t.BlockStatement> {
  if (owner.isProgram()) {
    return owner
  }
  const body = owner.get('body') as NodePath
  if (!body.isBlockStatement()) {
    throw new Error('concealStrings expected a normalized function body')
  }
  return body
}

function insertVault(
  body: NodePath<t.Program | t.BlockStatement>,
  entryCount: number,
  data: VaultData,
  cache: boolean,
): VaultIdentifiers {
  const fresh = (purpose: string): t.Identifier => t.identifier(body.scope.generateUid(purpose))
  const identifiers: VaultIdentifiers = {
    cache: cache ? fresh('stringCache') : null,
    decoder: fresh('stringDecoder'),
    metadata: fresh('stringMetadata'),
    payload: fresh('stringPayload'),
    pool: fresh('stringPool'),
  }
  const decoder = t.functionExpression(null, [], t.blockStatement([]))
  const declarations = [
    t.variableDeclarator(identifiers.pool, t.stringLiteral(data.pool)),
    t.variableDeclarator(identifiers.payload, numericArray(data.payload)),
    t.variableDeclarator(identifiers.metadata, numericArray(data.metadata)),
  ]
  if (identifiers.cache) {
    declarations.push(
      t.variableDeclarator(
        identifiers.cache,
        t.arrayExpression(Array.from({ length: entryCount }, () => t.nullLiteral())),
      ),
    )
  }
  declarations.push(t.variableDeclarator(identifiers.decoder, decoder))

  const declaration = t.variableDeclaration('const', declarations)
  const [declarationPath] = body.unshiftContainer('body', declaration)
  const declaratorPaths = declarationPath!.get('declarations') as NodePath<t.VariableDeclarator>[]
  const decoderPath = declaratorPaths
    .find((path) => path.node.init === decoder)!
    .get('init') as NodePath<t.FunctionExpression>
  populateDecoder(decoderPath, identifiers, data.indexMask)
  return identifiers
}

function populateDecoder(
  decoderPath: NodePath<t.FunctionExpression>,
  vault: VaultIdentifiers,
  indexMask: number,
): void {
  const fresh = (purpose: string): t.Identifier =>
    t.identifier(decoderPath.scope.generateUid(purpose))
  const entry = fresh('entry')
  const result = fresh('result')
  const record = fresh('record')
  const start = fresh('start')
  const length = fresh('length')
  const key = fresh('stringKey')
  const step = fresh('stringStep')
  const position = fresh('position')
  const mask = fresh('stringMask')
  const statements: t.Statement[] = []

  if (vault.cache) {
    const cached = fresh('cached')
    statements.push(
      t.variableDeclaration('let', [t.variableDeclarator(cached, indexed(vault.cache, entry))]),
      t.ifStatement(t.binaryExpression('!==', cached, t.nullLiteral()), t.returnStatement(cached)),
    )
  }

  statements.push(
    t.variableDeclaration('let', [
      t.variableDeclarator(result, t.stringLiteral('')),
      t.variableDeclarator(record, t.binaryExpression('*', entry, t.numericLiteral(RECORD_WIDTH))),
      t.variableDeclarator(start, indexed(vault.metadata, record)),
      t.variableDeclarator(
        length,
        indexed(vault.metadata, t.binaryExpression('+', record, t.numericLiteral(1))),
      ),
      t.variableDeclarator(
        key,
        indexed(vault.metadata, t.binaryExpression('+', record, t.numericLiteral(2))),
      ),
      t.variableDeclarator(
        step,
        indexed(vault.metadata, t.binaryExpression('+', record, t.numericLiteral(3))),
      ),
    ]),
    t.forStatement(
      t.variableDeclaration('let', [t.variableDeclarator(position, t.numericLiteral(0))]),
      t.binaryExpression('<', position, length),
      t.updateExpression('++', position),
      t.blockStatement([
        t.variableDeclaration('let', [
          t.variableDeclarator(mask, maskExpression(position, key, step, indexMask)),
        ]),
        t.expressionStatement(
          t.assignmentExpression(
            '+=',
            result,
            indexed(
              vault.pool,
              t.binaryExpression(
                '^',
                indexed(vault.payload, t.binaryExpression('+', start, position)),
                mask,
              ),
            ),
          ),
        ),
      ]),
    ),
  )
  if (vault.cache) {
    statements.push(
      t.expressionStatement(t.assignmentExpression('=', indexed(vault.cache, entry), result)),
    )
  }
  statements.push(t.returnStatement(result))
  decoderPath.node.params = [entry]
  decoderPath.node.body.body = statements
}

function maskExpression(
  position: t.Identifier,
  key: t.Identifier,
  step: t.Identifier,
  indexMask: number,
): t.Expression {
  return t.binaryExpression(
    '&',
    t.binaryExpression(
      '+',
      t.cloneNode(key),
      t.binaryExpression('*', t.cloneNode(position), t.cloneNode(step)),
    ),
    t.numericLiteral(indexMask),
  )
}

function indexed(object: t.Identifier, property: t.Expression): t.MemberExpression {
  return t.memberExpression(t.cloneNode(object), t.cloneNode(property), true)
}

function numericArray(values: readonly number[]): t.ArrayExpression {
  return t.arrayExpression(values.map((value) => t.numericLiteral(value)))
}
