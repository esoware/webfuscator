import traverse from '@babel/traverse'
import type { NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { isSideEffectFree } from '../analysis/purity'
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
 * var _stringPool = " lo,He";
 * var _stringPayload = [0, 4, 7, 2, 2, 6, 2],
 *   _stringMetadata = [0, 7, 4, 5],
 *   _stringCache = [null],
 *   _stringDecoder = function (_entry) {
 *     var _cached = _stringCache[_entry];
 *     if (_cached !== null) return _cached;
 *     var _result = "",
 *       _record = _entry * 4,
 *       _start = _stringMetadata[_record],
 *       _length = _stringMetadata[_record + 1],
 *       _stringKey = _stringMetadata[_record + 2],
 *       _stringStep = _stringMetadata[_record + 3];
 *     for (var _position = 0; _position < _length; _position++) {
 *       var _stringMask = _stringKey + _position * _stringStep & 7;
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
  const state: State = { changed: false, groups: new Map(), options, program: null }

  traverse(ast, collectVisitor, undefined, state)
  const groups = [...state.groups.values()]
  const work = planVaultWork(groups)
  const plannedGroups = new Set(work.flatMap((item) => item.groups))
  const eligibleGroups = groups.filter((group) => plannedGroups.has(group))
  if (eligibleGroups.length === 0) {
    return false
  }

  const pool = buildSharedPool(eligibleGroups, options.cover, rng)
  const poolIdentifier = t.identifier(state.program!.scope.generateUid('stringPool'))
  const concealedGroups = new Map(
    eligibleGroups.map((group) => [group, prepareGroup(group, pool, rng)]),
  )
  work.sort((left, right) => pathDepth(right.path) - pathDepth(left.path))
  for (const item of work) {
    concealWorkItem(
      item,
      item.groups.map((group) => concealedGroups.get(group)!),
      options.cache,
      poolIdentifier,
    )
    state.changed = true
  }
  insertSharedPool(state.program!, poolIdentifier, pool.value)
  return state.changed
}

interface ResolvedOptions {
  cache: boolean
  cover: 'full' | 'regional' | 'used'
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
  program: NodePath<t.Program> | null
}

interface Entry {
  occurrences: Occurrence[]
  value: string
}

interface ConcealedGroup {
  data: VaultData
  entries: Entry[]
  group: VaultGroup
}

interface WrapperWorkItem {
  groups: VaultGroup[]
  kind: 'wrapper'
  path: NodePath<
    t.ArrowFunctionExpression | t.ClassExpression | t.FunctionExpression | t.ObjectExpression
  >
}

interface ClosedWorkItem {
  groups: VaultGroup[]
  kind: 'closed'
  path: NodePath<t.ClassDeclaration | t.FunctionDeclaration>
  target: NodePath<t.Program | t.BlockStatement>
}

interface ProgramWorkItem {
  groups: VaultGroup[]
  kind: 'program'
  path: NodePath<t.Program>
}

type VaultWorkItem = ClosedWorkItem | ProgramWorkItem | WrapperWorkItem

interface VaultData {
  indexMask: number
  metadata: number[]
  payload: number[]
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
  Program(path, state) {
    state.program = path
  },
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
  const scope = options?.scope ?? 'program'
  if (typeof cache !== 'boolean') {
    throw new TypeError('concealStrings cache must be a boolean')
  }
  if (cover !== 'full' && cover !== 'regional' && cover !== 'used') {
    throw new TypeError("concealStrings cover must be 'full', 'regional', or 'used'")
  }
  if (scope !== 'function' && scope !== 'program') {
    throw new TypeError("concealStrings scope must be 'function' or 'program'")
  }
  return { cache, cover, scope }
}

function findVaultOwner(
  path: NodePath<t.StringLiteral>,
  scope: ResolvedOptions['scope'],
): VaultOwnerPath | null {
  let child: NodePath = path
  let current: NodePath | null = path.parentPath
  while (current) {
    if (
      current.isFunction() &&
      (child.key === 'body' || child.listKey === 'params') &&
      scope === 'function'
    ) {
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

function planVaultWork(groups: VaultGroup[]): VaultWorkItem[] {
  const work: VaultWorkItem[] = []
  const wrappers = new Map<t.Node, WrapperWorkItem>()
  for (const group of groups) {
    const owner = group.owner
    if (isInsideTopLevelModuleFunction(owner)) {
      continue
    }
    if (owner.isProgram()) {
      work.push({ groups: [group], kind: 'program', path: owner })
      continue
    }

    const wrapper = findWrapperPath(owner)
    if (wrapper && definitionCanBeWrapped(wrapper)) {
      let item = wrappers.get(wrapper.node)
      if (!item) {
        item = { groups: [], kind: 'wrapper', path: wrapper }
        wrappers.set(wrapper.node, item)
        work.push(item)
      }
      item.groups.push(group)
      continue
    }

    const declaration = findDeclarationPath(owner)
    const target = declaration && declarationTarget(declaration)
    if (declaration && target) {
      work.push({ groups: [group], kind: 'closed', path: declaration, target })
    }
  }
  return work
}

function isInsideTopLevelModuleFunction(owner: VaultOwnerPath): boolean {
  for (let current: NodePath | null = owner; current; current = current.parentPath) {
    if (!current.isFunctionDeclaration()) {
      continue
    }
    const statement = current.parentPath?.isExportDeclaration() ? current.parentPath : current
    if (statement.parentPath?.isProgram() && statement.parentPath.node.sourceType === 'module') {
      return true
    }
  }
  return false
}

function findWrapperPath(owner: VaultOwnerPath): WrapperWorkItem['path'] | null {
  if (owner.isArrowFunctionExpression() || owner.isFunctionExpression()) {
    return owner
  }
  if (owner.isObjectMethod() && owner.parentPath?.isObjectExpression()) {
    return owner.parentPath
  }
  if (owner.isClassMethod() || owner.isClassPrivateMethod()) {
    const classPath = owner.parentPath?.parentPath
    if (classPath?.isClassExpression()) {
      return classPath
    }
  }
  return null
}

function findDeclarationPath(
  owner: VaultOwnerPath,
): NodePath<t.ClassDeclaration | t.FunctionDeclaration> | null {
  if (owner.isFunctionDeclaration()) {
    return owner
  }
  if (owner.isClassMethod() || owner.isClassPrivateMethod()) {
    const classPath = owner.parentPath?.parentPath
    if (classPath?.isClassDeclaration()) {
      return classPath
    }
  }
  return null
}

function declarationTarget(
  declaration: NodePath<t.ClassDeclaration | t.FunctionDeclaration>,
): NodePath<t.Program | t.BlockStatement> | null {
  const parent = containingStatement(declaration).parentPath
  return parent?.isProgram() || parent?.isBlockStatement() ? parent : null
}

function containingStatement(
  declaration: NodePath<t.ClassDeclaration | t.FunctionDeclaration>,
): NodePath<t.Statement> {
  let statement: NodePath = declaration
  if (
    statement.parentPath?.isExportDefaultDeclaration() ||
    statement.parentPath?.isExportNamedDeclaration()
  ) {
    statement = statement.parentPath
  }
  while (statement.parentPath?.isLabeledStatement()) {
    statement = statement.parentPath
  }
  return statement as NodePath<t.Statement>
}

function definitionCanBeWrapped(path: WrapperWorkItem['path']): boolean {
  return (
    path.isArrowFunctionExpression() ||
    path.isFunctionExpression() ||
    isSideEffectFree(path.node, path.scope)
  )
}

function prepareGroup(group: VaultGroup, pool: SharedPool, rng: () => number): ConcealedGroup {
  const entries = makeEntries(group.occurrences)
  shuffleInPlace(entries, rng)
  return { data: encodeEntries(entries, pool, rng), entries, group }
}

function concealWorkItem(
  work: VaultWorkItem,
  groups: ConcealedGroup[],
  cache: boolean,
  pool: t.Identifier,
): void {
  if (work.kind === 'program') {
    const group = groups[0]!
    const identifiers = insertVault(work.path, group.entries.length, group.data, cache, pool)
    replaceOccurrences(work.path, group, identifiers.decoder)
    return
  }

  if (work.kind === 'closed') {
    const group = groups[0]!
    const decoder = insertClosedVault(
      work.target,
      work.path.isClassDeclaration() ? containingStatement(work.path) : null,
      group.entries.length,
      group.data,
      cache,
      pool,
    )
    replaceOccurrences(group.group.owner, group, decoder)
    return
  }

  concealWrappedGroups(work.path, groups, cache, pool)
}

function concealWrappedGroups(
  path: WrapperWorkItem['path'],
  groups: ConcealedGroup[],
  cache: boolean,
  pool: t.Identifier,
): void {
  const original = path.node
  const body = t.blockStatement([t.returnStatement(original)])
  const wrapper = path.isFunctionExpression()
    ? t.functionExpression(null, [], body)
    : t.arrowFunctionExpression([], body)
  path.replaceWith(t.callExpression(wrapper, []))

  const callPath = path as unknown as NodePath<t.CallExpression>
  const wrapperPath = callPath.get('callee') as NodePath<
    t.ArrowFunctionExpression | t.FunctionExpression
  >
  const wrapperBody = wrapperPath.get('body') as NodePath<t.BlockStatement>
  for (const group of groups) {
    const identifiers = insertVault(wrapperBody, group.entries.length, group.data, cache, pool)
    replaceOccurrences(callPath, group, identifiers.decoder)
  }
}

function replaceOccurrences(root: NodePath, group: ConcealedGroup, decoder: t.Identifier): void {
  const indexes = new Map<t.StringLiteral, number>()
  for (let index = 0; index < group.entries.length; index++) {
    for (const occurrence of group.entries[index]!.occurrences) {
      indexes.set(occurrence.path.node, index)
    }
  }
  root.traverse({
    StringLiteral(path) {
      const index = indexes.get(path.node)
      if (index === undefined) {
        return
      }
      path.replaceWith(t.callExpression(t.cloneNode(decoder), [t.numericLiteral(index)]))
      path.skip()
    },
  })
}

function pathDepth(path: NodePath): number {
  let depth = 0
  let current = path.parentPath
  while (current) {
    depth++
    current = current.parentPath
  }
  return depth
}

function makeEntries(occurrences: Occurrence[]): Entry[] {
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
  return { indexMask: pool.indexMask, metadata, payload }
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

function insertClosedVault(
  body: NodePath<t.Program | t.BlockStatement>,
  before: NodePath<t.Statement> | null,
  entryCount: number,
  data: VaultData,
  cache: boolean,
  pool: t.Identifier,
): t.Identifier {
  const closedDecoder = t.identifier(body.scope.generateUid('stringDecoder'))
  const factory = t.functionExpression(null, [], t.blockStatement([]))
  // Re-entered ordinary blocks need a distinct decoder binding for every function instance.
  const kind = body.isProgram() || body.parentPath?.isFunction() ? 'var' : 'let'
  const declaration = t.variableDeclaration(kind, [
    t.variableDeclarator(t.cloneNode(closedDecoder), t.callExpression(factory, [])),
  ])
  const [insertedDeclarationPath] = before
    ? before.insertBefore(declaration)
    : body.unshiftContainer('body', declaration)
  const [declaratorPath] = insertedDeclarationPath!.get(
    'declarations',
  ) as NodePath<t.VariableDeclarator>[]
  const callPath = declaratorPath!.get('init') as NodePath<t.CallExpression>
  const factoryPath = callPath.get('callee') as NodePath<t.FunctionExpression>
  const factoryBody = factoryPath.get('body') as NodePath<t.BlockStatement>
  const vault = insertVault(factoryBody, entryCount, data, cache, pool)
  factoryBody.pushContainer('body', t.returnStatement(t.cloneNode(vault.decoder)))
  return closedDecoder
}

function insertVault(
  body: NodePath<t.Program | t.BlockStatement>,
  entryCount: number,
  data: VaultData,
  cache: boolean,
  pool: t.Identifier,
): VaultIdentifiers {
  const fresh = (purpose: string): t.Identifier => t.identifier(body.scope.generateUid(purpose))
  const identifiers: VaultIdentifiers = {
    cache: cache ? fresh('stringCache') : null,
    decoder: fresh('stringDecoder'),
    metadata: fresh('stringMetadata'),
    payload: fresh('stringPayload'),
    pool,
  }
  const decoder = t.functionExpression(null, [], t.blockStatement([]))
  const declarations = [
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

  const declaration = t.variableDeclaration('var', declarations)
  const [vaultDeclarationPath] = body.unshiftContainer('body', declaration)
  const declaratorPaths = vaultDeclarationPath!.get(
    'declarations',
  ) as NodePath<t.VariableDeclarator>[]
  const decoderPath = declaratorPaths
    .find((path) => path.node.init === decoder)!
    .get('init') as NodePath<t.FunctionExpression>
  populateDecoder(decoderPath, identifiers, data.indexMask)
  return identifiers
}

function insertSharedPool(
  program: NodePath<t.Program>,
  identifier: t.Identifier,
  value: string,
): void {
  program.unshiftContainer(
    'body',
    t.variableDeclaration('var', [
      t.variableDeclarator(t.cloneNode(identifier), t.stringLiteral(value)),
    ]),
  )
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
      t.variableDeclaration('var', [t.variableDeclarator(cached, indexed(vault.cache, entry))]),
      t.ifStatement(t.binaryExpression('!==', cached, t.nullLiteral()), t.returnStatement(cached)),
    )
  }

  statements.push(
    t.variableDeclaration('var', [
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
      t.variableDeclaration('var', [t.variableDeclarator(position, t.numericLiteral(0))]),
      t.binaryExpression('<', position, length),
      t.updateExpression('++', position),
      t.blockStatement([
        t.variableDeclaration('var', [
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
