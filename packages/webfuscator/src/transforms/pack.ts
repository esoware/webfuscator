import generate from '@babel/generator'
import traverse from '@babel/traverse'
import type { NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import type { TransformContext } from '../options'
import { isInsideWith } from '../utils/ast'
import { isCalleeOrTagOf, isInStrictContext, referencesOrWritesVariable } from '../utils/paths'
import { mulberry32 } from '../utils/random'
import { StringGenerator } from '../utils/string-generator'

// The ECMAScript intrinsics and the common host globals. A detached Function
// body reaches every one of them and gets the same value, so pack can leave them
// bare. The CommonJS wrapper names (require, module, exports, __dirname,
// __filename) are left out on purpose. They are function parameters, not
// properties of the global object, so a Function body cannot see them and pack
// routes them like any other free name. `skipGlobals: true` opts into this list.
const STANDARD_GLOBALS: readonly string[] = [
  'globalThis',
  'self',
  'Infinity',
  'NaN',
  'undefined',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'decodeURI',
  'decodeURIComponent',
  'encodeURI',
  'encodeURIComponent',
  'escape',
  'unescape',
  'btoa',
  'atob',
  'structuredClone',
  'fetch',
  'queueMicrotask',
  'setTimeout',
  'clearTimeout',
  'setInterval',
  'clearInterval',
  'setImmediate',
  'clearImmediate',
  'Object',
  'Function',
  'Boolean',
  'Symbol',
  'BigInt',
  'Number',
  'Math',
  'Date',
  'String',
  'RegExp',
  'JSON',
  'Promise',
  'Proxy',
  'Reflect',
  'Error',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
  'AggregateError',
  'Array',
  'Map',
  'Set',
  'WeakMap',
  'WeakSet',
  'WeakRef',
  'FinalizationRegistry',
  'ArrayBuffer',
  'SharedArrayBuffer',
  'DataView',
  'Atomics',
  'Int8Array',
  'Uint8Array',
  'Uint8ClampedArray',
  'Int16Array',
  'Uint16Array',
  'Int32Array',
  'Uint32Array',
  'Float32Array',
  'Float64Array',
  'BigInt64Array',
  'BigUint64Array',
  'console',
  'crypto',
  'performance',
  'Intl',
  'URL',
  'URLSearchParams',
  'TextEncoder',
  'TextDecoder',
  'WebAssembly',
  'window',
  'document',
  'location',
  'postMessage',
  'alert',
  'confirm',
  'global',
  'process',
  'Buffer',
]

/**
 * Serializes the whole program to a string and rebuilds it at runtime through
 * the `Function` constructor. A detached function body only reaches true globals
 * and its own parameters. A free name might instead be a CommonJS `require`, a
 * bundler-injected binding, or a live import, none reachable from the body and
 * none distinguishable from a global at build time, so free names are routed
 * through a parameter object whose accessors run in the original top-level scope
 * and resolve each name there. Import declarations return above the call. `eval`
 * is left un-routed so a direct eval still reads the body scope. Names inside a
 * `with` stay un-routed too, since they may resolve against the with object at
 * runtime. Export statements cannot live inside a Function body, so pack throws
 * on them. It packs everything else as written. Code that needs `import.meta`,
 * top-level await, dynamic `import()`, or a top-level `arguments` will not run
 * once moved into a Function body.
 *
 * @example
 * // ◀️ before
 * console.log(value);
 *
 * // ▶️ after
 * Function("M", "return M[\"b\"].log(M[\"_\"]);")({
 *   get "b"() {
 *     return console;
 *   },
 *   get "_"() {
 *     return value;
 *   }
 * });
 */
export function pack(ast: File, ctx: TransformContext): boolean {
  let programPath: NodePath<t.Program> | null = null
  traverse(ast, {
    Program(path) {
      programPath = path
      path.stop()
    },
  })
  if (!programPath) {
    return false
  }
  return packProgram(programPath, ctx)
}

function packProgram(programPath: NodePath<t.Program>, ctx: TransformContext): boolean {
  assertNoExports(programPath)
  const importPaths = collectImportDeclarations(programPath)
  const importDeclarations = importPaths.map((path) => path.node)
  // An import named `Function` shadows the constructor at the output top level,
  // so the wrap reaches the real one through a function instance instead.
  const shadowedConstructor = importDeclarations.some((declaration) =>
    bindsFunctionConstructor(declaration),
  )

  const programNode = programPath.node
  const wasModule = programNode.sourceType === 'module'
  // Escaping strict is a deliberate opt-in: drop the directive so the packed
  // body runs sloppy even when the source was strict.
  const escapeStrict = ctx.pack?.escapeStrict ?? false
  const bodyStrict = !escapeStrict && isInStrictContext(programPath)

  // Detaching imports drops their bindings, so their names read as free and are
  // routed like any other global. The declarations return at the output top
  // level, where the accessors close over them.
  for (const path of importPaths) {
    path.remove()
  }
  programPath.scope.crawl()

  const usedNames = collectUsedNames(programNode, importDeclarations)
  const generator = new StringGenerator(ctx.stringGeneratorMode, mulberry32(ctx.seed))
  const freshIdentifier = (): string => {
    let name: string
    do {
      name = generator.next()
    } while (usedNames.has(name))
    usedNames.add(name)
    return name
  }
  const objectName = freshIdentifier()
  const setterParam = freshIdentifier()

  const readProperties = new Map<string, string>()
  const typeofProperties = new Map<string, string>()
  const settable = new Set<string>()
  const freshProperty = (): string => {
    let property: string
    do {
      // `__proto__` as an object-literal key would set the prototype rather
      // than name an accessor.
      property = generator.next()
    } while (property === '__proto__')
    return property
  }
  const propertyFor = (registry: Map<string, string>, name: string): string => {
    let property = registry.get(name)
    if (property === undefined) {
      property = freshProperty()
      registry.set(name, property)
    }
    return property
  }
  const memberFor = (property: string): t.MemberExpression =>
    t.memberExpression(t.identifier(objectName), t.stringLiteral(property), true)

  // Import locals read as free once detached but are unreachable from a Function
  // body, so they route even when the caller lists them in skipGlobals.
  const importedNames = new Set<string>()
  for (const declaration of importDeclarations) {
    for (const specifier of declaration.specifiers) {
      importedNames.add(specifier.local.name)
    }
  }
  const skipOption = ctx.pack?.skipGlobals ?? false
  let skipNames: readonly string[] = []
  if (skipOption === true) {
    skipNames = STANDARD_GLOBALS
  } else if (skipOption !== false) {
    skipNames = skipOption
  }
  const skip = new Set<string>(skipNames)

  const isRoutable = (path: NodePath<t.Identifier>): boolean => {
    const name = path.node.name
    // The wrapper parameter stays as written. `arguments` and `eval` are never
    // routed: `arguments` binds to its own function's object, and leaving `eval`
    // bare keeps a direct eval reading the body scope rather than the global one.
    if (name === objectName || name === 'arguments' || name === 'eval') {
      return false
    }
    // Inside `with`, a free name may resolve to a property of the with object at
    // runtime, so routing it to the top-level accessor would change behavior.
    if (isInsideWith(path)) {
      return false
    }
    if (!referencesOrWritesVariable(path)) {
      return false
    }
    if (path.scope.getBinding(name)) {
      return false
    }
    return importedNames.has(name) || !skip.has(name)
  }

  // A strict script's top-level `this` is the global object, but a strict
  // Function called plainly sees `undefined`. Rather than reach for `.call`,
  // route top-level `this` through a captured property like any free name.
  const routeTopLevelThis = bodyStrict && !wasModule
  let thisProperty: string | null = null

  const routingVisitor: Visitor = {
    ThisExpression(path) {
      if (!routeTopLevelThis || !isTopLevelThis(path)) {
        return
      }
      if (thisProperty === null) {
        thisProperty = freshProperty()
      }
      path.replaceWith(memberFor(thisProperty))
    },
    UnaryExpression(path) {
      if (path.node.operator !== 'typeof') {
        return
      }
      const argument = path.get('argument')
      // A bare `typeof name` must not throw for an undeclared global, so it maps
      // to an accessor that applies `typeof` in the original scope.
      if (!argument.isIdentifier() || !isRoutable(argument)) {
        return
      }
      path.replaceWith(memberFor(propertyFor(typeofProperties, argument.node.name)))
    },
    Identifier(path) {
      // `delete name` must keep hitting the global binding; `delete obj[prop]`
      // would drop the accessor instead. A real global stays reachable bare.
      if (isBareDeleteArgument(path) || !isRoutable(path)) {
        return
      }
      const name = path.node.name
      if (isWriteReference(path)) {
        settable.add(name)
      }
      const member = memberFor(propertyFor(readProperties, name))
      // A member callee would bind `this` to the object; the comma discards the
      // base and keeps the original receiver.
      path.replaceWith(
        isCalleeOrTagOf(path) ? t.sequenceExpression([t.numericLiteral(0), member]) : member,
      )
    },
  }
  programPath.traverse(routingVisitor)

  // The script completion value is its trailing expression; returning it keeps
  // `eval` of the packed output producing the same value.
  const body = programNode.body
  const lastStatement = body.at(-1)
  if (lastStatement && t.isExpressionStatement(lastStatement)) {
    body[body.length - 1] = t.returnStatement(lastStatement.expression)
  }

  const innerDirectives = bodyStrict ? [t.directive(t.directiveLiteral('use strict'))] : []
  const innerCode = generate(t.program(body, innerDirectives, 'script'), {
    minified: true,
    comments: false,
  }).code

  const objectExpression = buildAccessorObject({
    readProperties,
    typeofProperties,
    settable,
    setterParam,
    strict: bodyStrict,
    thisProperty,
  })

  const constructorReference = shadowedConstructor
    ? t.memberExpression(
        t.functionExpression(null, [], t.blockStatement([])),
        t.identifier('constructor'),
      )
    : t.identifier('Function')
  const wrapper = t.callExpression(constructorReference, [
    t.stringLiteral(objectName),
    t.stringLiteral(innerCode),
  ])
  const invocation = t.callExpression(wrapper, [objectExpression])

  programNode.body = [...importDeclarations, t.expressionStatement(invocation)]
  programNode.directives = []
  programNode.sourceType = importDeclarations.length > 0 ? 'module' : 'script'
  return true
}

// Export statements are module-only syntax and cannot exist inside a Function
// body. Pack throws rather than emit output that fails to parse at runtime.
function assertNoExports(programPath: NodePath<t.Program>): void {
  const hasExport = programPath.node.body.some(
    (statement) =>
      t.isExportNamedDeclaration(statement) ||
      t.isExportDefaultDeclaration(statement) ||
      t.isExportAllDeclaration(statement),
  )
  if (hasExport) {
    throw new Error('pack cannot wrap a program that uses export statements')
  }
}

function collectImportDeclarations(
  programPath: NodePath<t.Program>,
): NodePath<t.ImportDeclaration>[] {
  return programPath
    .get('body')
    .filter((statement): statement is NodePath<t.ImportDeclaration> =>
      statement.isImportDeclaration(),
    )
}

function bindsFunctionConstructor(declaration: t.ImportDeclaration): boolean {
  return declaration.specifiers.some((specifier) => specifier.local.name === 'Function')
}

// A `this` refers to the top-level `this` when no enclosing non-arrow function,
// class field, or static block captures it before the program does. A computed
// member key is the exception: it evaluates in the scope surrounding its method
// or field, not that member's `this`, so a `this` reached through a boundary's
// `key` skips it and keeps looking outward. `thisBinding` keeps every path
// predicate off the walked `current`, whose narrowed union would otherwise trip
// NodePath's invariant generic when reassigned to `child`.
function isTopLevelThis(path: NodePath<t.ThisExpression>): boolean {
  let child: NodePath = path
  let current: NodePath | null = path.parentPath
  while (current) {
    const binding = thisBinding(current)
    if (binding === 'program') {
      return true
    }
    if (binding === 'captured' && child.key !== 'key') {
      return false
    }
    child = current
    current = current.parentPath
  }
  return false
}

function thisBinding(boundary: NodePath): 'captured' | 'program' | null {
  if (boundary.isProgram()) {
    return 'program'
  }
  if (
    (boundary.isFunction() && !boundary.isArrowFunctionExpression()) ||
    boundary.isClassProperty() ||
    boundary.isClassPrivateProperty() ||
    boundary.isStaticBlock()
  ) {
    return 'captured'
  }
  return null
}

function isBareDeleteArgument(path: NodePath<t.Identifier>): boolean {
  const parent = path.parentPath
  return (
    parent != null &&
    parent.isUnaryExpression({ operator: 'delete' }) &&
    parent.node.argument === path.node
  )
}

function isWriteReference(path: NodePath<t.Identifier>): boolean {
  const parent = path.parentPath
  if (!parent) {
    return false
  }
  const node = path.node
  if (parent.isAssignmentExpression() && parent.node.left === node) {
    return true
  }
  if (parent.isUpdateExpression() && parent.node.argument === node) {
    return true
  }
  if ((parent.isForInStatement() || parent.isForOfStatement()) && parent.node.left === node) {
    return true
  }
  // Destructuring assignment targets bind through patterns Babel flags here.
  return path.isBindingIdentifier()
}

function collectUsedNames(
  program: t.Program,
  importDeclarations: t.ImportDeclaration[],
): Set<string> {
  // The wrapper parameter and setter parameter must avoid every name the body
  // uses, so no nested binding can shadow their accesses.
  const names = new Set<string>(['Function'])
  for (const declaration of importDeclarations) {
    for (const specifier of declaration.specifiers) {
      names.add(specifier.local.name)
    }
  }
  t.traverseFast(program, (node) => {
    if (t.isIdentifier(node)) {
      names.add(node.name)
    }
  })
  return names
}

interface AccessorObjectSpec {
  readProperties: Map<string, string>
  setterParam: string
  settable: Set<string>
  strict: boolean
  thisProperty: string | null
  typeofProperties: Map<string, string>
}

function buildAccessorObject(spec: AccessorObjectSpec): t.ObjectExpression {
  const properties: (t.ObjectMethod | t.ObjectProperty)[] = []
  for (const [name, property] of spec.readProperties) {
    properties.push(
      t.objectMethod(
        'get',
        t.stringLiteral(property),
        [],
        t.blockStatement([t.returnStatement(t.identifier(name))]),
      ),
    )
    if (spec.settable.has(name)) {
      const setterBody = t.blockStatement([
        t.expressionStatement(
          t.assignmentExpression('=', t.identifier(name), t.identifier(spec.setterParam)),
        ),
      ])
      // A strict script becomes a sloppy output script, so the setter stays
      // strict to keep an undeclared-global write throwing.
      if (spec.strict) {
        setterBody.directives.push(t.directive(t.directiveLiteral('use strict')))
      }
      properties.push(
        t.objectMethod(
          'set',
          t.stringLiteral(property),
          [t.identifier(spec.setterParam)],
          setterBody,
        ),
      )
    }
  }
  for (const [name, property] of spec.typeofProperties) {
    properties.push(
      t.objectMethod(
        'get',
        t.stringLiteral(property),
        [],
        t.blockStatement([t.returnStatement(t.unaryExpression('typeof', t.identifier(name)))]),
      ),
    )
  }
  // This is a data property. Its `this` value evaluates in the output script's
  // top-level scope, where `this` is the global object. A getter would bind
  // `this` to the accessor object instead.
  if (spec.thisProperty !== null) {
    properties.push(t.objectProperty(t.stringLiteral(spec.thisProperty), t.thisExpression()))
  }
  return t.objectExpression(properties)
}
