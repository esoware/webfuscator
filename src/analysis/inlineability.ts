import traverse from '@babel/traverse'
import type { Binding, NodePath, Visitor } from '@babel/traverse'
import * as t from '@babel/types'
import type { File } from '@babel/types'

import { walkOwnFunctionScope } from 'src/utils/ast'
import { hasAnnexBFunctionAlias, referencesOrWritesVariable } from 'src/utils/paths'

export interface InlineCandidate {
  name: string
  fnNode: t.Function
  fnPath: NodePath<t.Function>
  binding: Binding
  params: string[]
  declarationPath: NodePath
}

// Tarjan SCC removal prevents endless expansion of mutually recursive bodies.
export function analyzeInlineability(ast: File): Map<string, InlineCandidate> {
  const rawCandidates: InlineCandidate[] = []

  // Earlier passes can leave `binding.referencePaths` on detached nodes.
  traverse(ast, {
    Program(path) {
      path.scope.crawl()
    },
    FunctionDeclaration(path) {
      if (!path.node.id) {
        return
      }
      // Babel misses the sloppy Annex B `var` alias of a block-level function.
      if (hasAnnexBFunctionAlias(path)) {
        return
      }
      const binding = path.scope.getBinding(path.node.id.name)
      if (!binding) {
        return
      }

      const candidate = checkCandidate(path.node.id.name, binding, path.node, path, path)
      if (candidate) {
        rawCandidates.push(candidate)
      }
    },

    VariableDeclarator(path) {
      if (!t.isIdentifier(path.node.id)) {
        return
      }
      const { init } = path.node
      if (!t.isFunctionExpression(init)) {
        return
      }

      const binding = path.scope.getBinding(path.node.id.name)
      if (!binding) {
        return
      }

      const declPath = path.parentPath
      if (!declPath) {
        return
      }

      const initPath = path.get('init') as NodePath<t.FunctionExpression>
      const candidate = checkCandidate(path.node.id.name, binding, init, initPath, declPath)
      if (candidate) {
        rawCandidates.push(candidate)
      }
    },
  })

  const candidateByName = new Map<string, InlineCandidate>()
  for (const candidate of rawCandidates) {
    candidateByName.set(candidate.name, candidate)
  }

  // Self-reference is already excluded, leaving Tarjan to remove larger cycles.
  const edges = new Map<string, Set<string>>()
  for (const candidate of rawCandidates) {
    const callees = new Set<string>()
    walkOwnFunctionScope(candidate.fnNode.body, (node) => {
      if (t.isIdentifier(node) && node.name !== candidate.name && candidateByName.has(node.name)) {
        callees.add(node.name)
      }
    })
    edges.set(candidate.name, callees)
  }

  const inCycle = new Set<string>()
  for (const scc of tarjanSCC(
    rawCandidates.map((candidate) => candidate.name),
    edges,
  )) {
    if (scc.length > 1) {
      for (const name of scc) {
        inCycle.add(name)
      }
    }
  }

  for (const name of inCycle) {
    candidateByName.delete(name)
  }
  return candidateByName
}

function checkCandidate(
  name: string,
  binding: Binding,
  fnNode: t.Function,
  fnPath: NodePath,
  declarationPath: NodePath,
): InlineCandidate | null {
  if (fnNode.generator || fnNode.async) {
    return null
  }
  if (!t.isBlockStatement(fnNode.body)) {
    return null
  }
  // Writes live in `constantViolations`, not `referencePaths`. Any write can
  // make a call resolve to a different function.
  if (binding.constantViolations.length > 0) {
    return null
  }
  // Splicing loses a named function expression's inner binding.
  if (t.isFunctionExpression(fnNode) && fnNode.id) {
    return null
  }
  // The flat renamer cannot preserve nested declarations after relocation.
  if (bodyHasUnrelocatableDeclaration(fnNode.body)) {
    return null
  }
  if (!validateCallSites(binding)) {
    return null
  }

  const params: (string | null)[] = fnNode.params.map((param) =>
    t.isIdentifier(param) ? param.name : null,
  )
  if (params.some((param) => param === null)) {
    return null
  }

  const analysis = analyzeBody(name, fnPath as NodePath<t.Function>)
  if (analysis.unsafe || analysis.closureCapture) {
    return null
  }

  return {
    name,
    fnNode,
    fnPath: fnPath as NodePath<t.Function>,
    binding,
    params: params as string[],
    declarationPath,
  }
}

function bodyHasUnrelocatableDeclaration(body: t.BlockStatement): boolean {
  let found = false
  t.traverseFast(body, (node) => {
    if (found) {
      return t.traverseFast.skip
    }
    // Function declarations hoist into the relocated scope. Expressions do not.
    if (node !== body && t.isFunction(node)) {
      if (t.isFunctionDeclaration(node)) {
        found = true
      }
      return t.traverseFast.skip
    }
    if (
      t.isClassDeclaration(node) ||
      (t.isVariableDeclaration(node) && node.kind !== 'var') ||
      (t.isVariableDeclarator(node) && !t.isIdentifier(node.id))
    ) {
      found = true
    }
    return found ? t.traverseFast.skip : undefined
  })
  return found
}

function validateCallSites(binding: Binding): boolean {
  for (const ref of binding.referencePaths) {
    const parent = ref.parentPath
    if (!parent || !parent.isCallExpression() || parent.node.callee !== ref.node) {
      return false
    }
    if (parent.node.arguments.some((arg) => t.isSpreadElement(arg))) {
      return false
    }
  }
  return true
}

interface BodyAnalysis {
  unsafe: boolean
  closureCapture: boolean
}

function analyzeBody(name: string, fnPath: NodePath<t.Function>): BodyAnalysis {
  const state: AnalyzeBodyState = {
    candidateName: name,
    outerScope: fnPath.scope,
    innerFnDepth: 0,
    unsafe: false,
    closureCapture: false,
  }
  // Start at the body to exclude the function id and parameter bindings.
  const bodyPath = fnPath.get('body') as NodePath
  bodyPath.traverse(analyzeBodyVisitor, state)

  return { unsafe: state.unsafe, closureCapture: state.closureCapture }
}

interface AnalyzeBodyState {
  candidateName: string
  outerScope: NodePath<t.Function>['scope']
  innerFnDepth: number
  unsafe: boolean
  closureCapture: boolean
}

const analyzeBodyVisitor: Visitor<AnalyzeBodyState> = {
  Function: {
    enter(path, state) {
      if (state.unsafe || state.closureCapture) {
        path.stop()
        return
      }
      if (!path.isArrowFunctionExpression()) {
        state.innerFnDepth++
      }
    },
    exit(path, state) {
      if (!path.isArrowFunctionExpression()) {
        state.innerFnDepth--
      }
    },
  },
  ThisExpression(path, state) {
    if (state.innerFnDepth === 0) {
      state.unsafe = true
      path.stop()
    }
  },
  Super(path, state) {
    if (state.innerFnDepth === 0) {
      state.unsafe = true
      path.stop()
    }
  },
  MetaProperty(path, state) {
    if (
      state.innerFnDepth === 0 &&
      path.node.meta.name === 'new' &&
      path.node.property.name === 'target'
    ) {
      state.unsafe = true
      path.stop()
    }
  },
  WithStatement(path, state) {
    state.unsafe = true
    path.stop()
  },
  Identifier(path, state) {
    const { name } = path.node
    if (
      state.innerFnDepth === 0 &&
      (name === 'arguments' || name === 'eval' || name === state.candidateName)
    ) {
      state.unsafe = true
      path.stop()
      return
    }
    // Destructured writes are neither references nor direct assignment children.
    if (!referencesOrWritesVariable(path)) {
      return
    }
    if (state.innerFnDepth > 0 && state.outerScope.bindings[name]) {
      const binding = path.scope.getBinding(name)
      if (binding && state.outerScope.bindings[name] === binding) {
        state.closureCapture = true
        path.stop()
      }
    }
  },
}

function tarjanSCC(nodes: string[], edges: Map<string, Set<string>>): string[][] {
  let index = 0
  const stack: string[] = []
  const onStack = new Set<string>()
  const indices = new Map<string, number>()
  const lowlinks = new Map<string, number>()
  const result: string[][] = []

  function strongConnect(vertex: string): void {
    indices.set(vertex, index)
    lowlinks.set(vertex, index)
    index++
    stack.push(vertex)
    onStack.add(vertex)

    for (const successor of edges.get(vertex) ?? []) {
      if (!indices.has(successor)) {
        strongConnect(successor)
        lowlinks.set(vertex, Math.min(lowlinks.get(vertex)!, lowlinks.get(successor)!))
      } else if (onStack.has(successor)) {
        lowlinks.set(vertex, Math.min(lowlinks.get(vertex)!, indices.get(successor)!))
      }
    }

    if (lowlinks.get(vertex) === indices.get(vertex)) {
      const scc: string[] = []
      let popped: string
      do {
        popped = stack.pop()!
        onStack.delete(popped)
        scc.push(popped)
      } while (popped !== vertex)
      result.push(scc)
    }
  }

  for (const vertex of nodes) {
    if (!indices.has(vertex)) {
      strongConnect(vertex)
    }
  }

  return result
}
