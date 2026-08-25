import traverse from '@babel/traverse'
import type { Binding, Scope } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import type { TransformContext } from '../options'
import { referencesOrWritesVariable } from '../utils/paths'
import { mulberry32 } from '../utils/random'
import { StringGenerator } from '../utils/string-generator'

/**
 * Renames bindings and labels with the configured string generator. Generated
 * names do not capture unresolved names or bindings still used from an outer
 * scope. Separate sibling scopes may reuse the same names.
 *
 * @example
 * // ◀️ before
 * function compute(value, multiplier) {
 *   var scaled = value * multiplier;
 *   return scaled;
 * }
 * compute(3, 4);
 *
 * // ▶️ after
 * function a(b, c) {
 *   var d = b * c;
 *   return d;
 * }
 * a(3, 4);
 */
export function renameIdentifiers(ast: File, ctx: TransformContext): boolean {
  const generator = new StringGenerator(ctx.stringGeneratorMode, mulberry32(ctx.seed))
  const separatedDirectExports = separateDirectExports(ast.program)

  let programScope: Scope | undefined
  traverse(ast, {
    Program(path) {
      programScope = path.scope
      path.stop()
    },
  })
  if (!programScope) {
    return separatedDirectExports
  }
  programScope.crawl()

  const liveAncestors = new Map<Scope, Set<Binding>>()
  // Reserve unbound names so generated bindings cannot capture them.
  const freeNames = new Set<string>()
  const unrenamable = new Set<Binding>()
  // Reserve pinned source names globally, including before their binding is seen.
  const pinnedNames = new Set<string>()
  const pin = (binding: Binding, name: string): void => {
    unrenamable.add(binding)
    pinnedNames.add(name)
  }
  traverse(ast, {
    Identifier(path) {
      if (isNonBindingPosition(path)) {
        return
      }
      const binding = path.scope.getBinding(path.node.name)
      if (!binding) {
        // Assignment-only globals are free names even without a read reference.
        if (referencesOrWritesVariable(path)) {
          freeNames.add(path.node.name)
        }
        return
      }
      let scope: Scope | undefined = path.scope
      while (scope && scope !== binding.scope) {
        let live = liveAncestors.get(scope)
        if (!live) {
          live = new Set()
          liveAncestors.set(scope, live)
        }
        live.add(binding)
        scope = scope.parent
      }
    },
    CatchClause(path) {
      // Babel splits a catch parameter and same-named `var` that share one runtime
      // variable. They must keep the same name.
      const fnScope = path.scope.getFunctionParent() ?? path.scope.getProgramParent()
      for (const name of Object.keys(path.scope.bindings)) {
        const varBinding = fnScope.getOwnBinding(name)
        if (varBinding) {
          pin(path.scope.bindings[name]!, name)
          pin(varBinding, name)
        }
      }
    },
  })

  const bindingToName = new Map<Binding, string>()
  const idToName = new WeakMap<t.Identifier, string>()

  traverse(ast, {
    Scopable(path) {
      const scope = path.scope
      // Test global reservations during allocation to avoid copying them per scope.
      const offLimits = new Set<string>()
      const live = liveAncestors.get(scope)
      if (live) {
        for (const ancestor of live) {
          const name = bindingToName.get(ancestor)
          if (name !== undefined) {
            offLimits.add(name)
          }
        }
      }

      let cursor = 0
      for (const oldName of Object.keys(scope.bindings)) {
        const binding = scope.bindings[oldName]!
        if (!t.isIdentifier(binding.identifier)) {
          continue
        }
        // `pin` already reserved this binding's source name.
        if (unrenamable.has(binding)) {
          continue
        }

        const inherited = idToName.get(binding.identifier)
        if (inherited !== undefined) {
          bindingToName.set(binding, inherited)
          offLimits.add(inherited)
          continue
        }

        let newName: string
        do {
          newName = generator.at(cursor++)
        } while (offLimits.has(newName) || freeNames.has(newName) || pinnedNames.has(newName))

        offLimits.add(newName)
        bindingToName.set(binding, newName)
        idToName.set(binding.identifier, newName)
      }
    },
  })

  if (bindingToName.size === 0) {
    return renameLabels(ast, generator) || separatedDirectExports
  }

  traverse(ast, {
    Identifier(path) {
      const node = path.node
      const directName = idToName.get(node)
      if (directName !== undefined) {
        node.name = directName
        return
      }
      if (isNonBindingPosition(path)) {
        return
      }
      const binding = path.scope.getBinding(node.name)
      if (!binding) {
        return
      }
      const newName = bindingToName.get(binding)
      if (newName === undefined) {
        return
      }
      node.name = newName
    },
  })

  renameLabels(ast, generator)
  return true
}

function separateDirectExports(program: t.Program): boolean {
  const body: t.Program['body'] = []
  let changed = false

  for (const statement of program.body) {
    const declaration = t.isExportNamedDeclaration(statement) ? statement.declaration : null
    if (
      !t.isVariableDeclaration(declaration) &&
      !t.isFunctionDeclaration(declaration) &&
      !t.isClassDeclaration(declaration)
    ) {
      body.push(statement)
      continue
    }

    const names = Object.keys(t.getBindingIdentifiers(declaration))
    if (names.length === 0) {
      body.push(statement)
      continue
    }

    body.push(
      declaration,
      t.exportNamedDeclaration(
        null,
        names.map((name) => t.exportSpecifier(t.identifier(name), t.identifier(name))),
      ),
    )
    changed = true
  }

  if (changed) {
    program.body = body
  }
  return changed
}

function isNonBindingPosition(path: { node: t.Identifier; parent: t.Node }): boolean {
  const node = path.node
  const parent = path.parent
  // A PrivateName id is not a variable and must match its class declaration.
  if (t.isPrivateName(parent)) {
    return true
  }
  if (t.isMemberExpression(parent) && parent.property === node && !parent.computed) {
    return true
  }
  if (t.isOptionalMemberExpression(parent) && parent.property === node && !parent.computed) {
    return true
  }
  if (
    (t.isObjectProperty(parent) || t.isObjectMethod(parent)) &&
    parent.key === node &&
    !parent.computed
  ) {
    return true
  }
  if (
    (t.isClassMethod(parent) || t.isClassProperty(parent) || t.isClassPrivateProperty(parent)) &&
    'key' in parent &&
    parent.key === node &&
    !('computed' in parent && parent.computed)
  ) {
    return true
  }
  // External import and export names are part of the module contract.
  if (t.isImportSpecifier(parent) && parent.imported === node) {
    return true
  }
  if (t.isExportSpecifier(parent) && parent.exported === node) {
    return true
  }
  if (t.isLabeledStatement(parent) && parent.label === node) {
    return true
  }
  if (t.isBreakStatement(parent) && parent.label === node) {
    return true
  }
  if (t.isContinueStatement(parent) && parent.label === node) {
    return true
  }
  if (t.isMetaProperty(parent)) {
    return true
  }
  return false
}

function renameLabels(ast: File, generator: StringGenerator): boolean {
  const labelRenames: { node: t.LabeledStatement; oldName: string; newName: string }[] = []
  traverse(ast, {
    LabeledStatement(path) {
      labelRenames.push({
        node: path.node,
        oldName: path.node.label.name,
        newName: generator.next(),
      })
    },
  })

  if (labelRenames.length === 0) {
    return false
  }

  for (const { node, oldName, newName } of labelRenames) {
    node.label.name = newName
    rewriteLabelReferences(node, oldName, newName)
  }
  return true
}

// A same-named inner label owns its references and is renamed separately.
function rewriteLabelReferences(node: t.LabeledStatement, oldName: string, newName: string): void {
  t.traverseFast(node.body, (visited) => {
    const shadowedByInnerLabel =
      t.isLabeledStatement(visited) && visited !== node && visited.label.name === oldName
    if (!shadowedByInnerLabel) {
      if (t.isBreakStatement(visited) && visited.label?.name === oldName) {
        visited.label.name = newName
      }
      if (t.isContinueStatement(visited) && visited.label?.name === oldName) {
        visited.label.name = newName
      }
    }
    return shadowedByInnerLabel ? t.traverseFast.skip : undefined
  })
}
