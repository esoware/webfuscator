import generate from '@babel/generator'
import traverse from '@babel/traverse'
import type { NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import type { TransformContext } from 'src/options'
import { isInsideWith } from 'src/utils/ast'
import { isCalleeOrTagOf, isInStrictContext, referencesOrWritesVariable } from 'src/utils/paths'
import { mulberry32 } from 'src/utils/random'
import { StringGenerator } from 'src/utils/string-generator'

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
  const propertyFor = (registry: Map<string, string>, name: string): string => {
    let property = registry.get(name)
    if (property === undefined) {
      do {
        // `__proto__` as an object-literal key would set the prototype rather
        // than name an accessor.
        property = generator.next()
      } while (property === '__proto__')
      registry.set(name, property)
    }
    return property
  }
  const memberFor = (property: string): t.MemberExpression =>
    t.memberExpression(t.identifier(objectName), t.stringLiteral(property), true)

  const isRoutable = (path: NodePath<t.Identifier>): boolean => {
    const { name } = path.node
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
    return !path.scope.getBinding(name)
  }

  const routingVisitor: Visitor = {
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
      const { name } = path.node
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
  const { body } = programNode
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
  // A strict script keeps top-level `this` bound to the global object. A plainly
  // called strict function would instead see `undefined`, so pass the global
  // `this` of the sloppy output script.
  const invocation =
    bodyStrict && !wasModule
      ? t.callExpression(t.memberExpression(wrapper, t.identifier('call')), [
          t.thisExpression(),
          objectExpression,
        ])
      : t.callExpression(wrapper, [objectExpression])

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
  const { node } = path
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
  typeofProperties: Map<string, string>
}

function buildAccessorObject(spec: AccessorObjectSpec): t.ObjectExpression {
  const { readProperties, setterParam, settable, strict, typeofProperties } = spec
  const properties: t.ObjectMethod[] = []
  for (const [name, property] of readProperties) {
    properties.push(
      t.objectMethod(
        'get',
        t.stringLiteral(property),
        [],
        t.blockStatement([t.returnStatement(t.identifier(name))]),
      ),
    )
    if (settable.has(name)) {
      const setterBody = t.blockStatement([
        t.expressionStatement(
          t.assignmentExpression('=', t.identifier(name), t.identifier(setterParam)),
        ),
      ])
      // A strict script becomes a sloppy output script, so the setter stays
      // strict to keep an undeclared-global write throwing.
      if (strict) {
        setterBody.directives.push(t.directive(t.directiveLiteral('use strict')))
      }
      properties.push(
        t.objectMethod('set', t.stringLiteral(property), [t.identifier(setterParam)], setterBody),
      )
    }
  }
  for (const [name, property] of typeofProperties) {
    properties.push(
      t.objectMethod(
        'get',
        t.stringLiteral(property),
        [],
        t.blockStatement([t.returnStatement(t.unaryExpression('typeof', t.identifier(name)))]),
      ),
    )
  }
  return t.objectExpression(properties)
}
