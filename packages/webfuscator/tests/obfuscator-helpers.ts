import { obfuscate } from 'src/index'
import type { ObfuscatorOptions } from 'src/index'

const TRANSFORM_PIPELINE = {
  argumentsToParameters: true,
  arrowToFunction: true,
  collapseSingleUseTemps: true,
  constLetToVar: true,
  constToLet: true,
  doWhileToWhile: true,
  dropConsole: true,
  dropDebugger: true,
  expandBinaryAssignment: true,
  expandLogicalAssignment: true,
  extractObjectProperties: true,
  foldBuiltinMethods: true,
  foldConstants: true,
  forToWhile: true,
  functionDeclarationToExpression: true,
  inlineFunctions: true,
  logicalToTernary: true,
  mangleProperties: false,
  nullishCoalescingToTernary: true,
  numbersToStrings: true,
  objectMethodToProperty: true,
  optionalChainingToTernary: true,
  pack: false,
  packDeclarationsIntoParameters: true,
  removeAnonymousFunctionNames: true,
  removeUnreachableCode: true,
  removeUnusedCode: true,
  renameIdentifiers: true,
  specialsToStrings: true,
  switchToIf: true,
  ternaryToIf: true,
  updateToAssignment: true,
  yodifyConditions: true,
} satisfies NonNullable<ObfuscatorOptions['transforms']>

export function obfuscateWithTransformPipeline(
  code: string,
  options: ObfuscatorOptions = {},
): string {
  return obfuscate(code, {
    ...options,
    transforms: { ...TRANSFORM_PIPELINE, ...options.transforms },
  })
}
