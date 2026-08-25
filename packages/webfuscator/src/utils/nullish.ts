import * as t from '@babel/types'

export function buildNullishCheck(
  firstRead: t.Expression,
  secondRead: t.Expression,
): t.ConditionalExpression {
  return t.conditionalExpression(
    t.binaryExpression('===', firstRead, t.nullLiteral()),
    t.booleanLiteral(true),
    t.binaryExpression('===', secondRead, t.unaryExpression('void', t.numericLiteral(0))),
  )
}

export function buildNonNullishCheck(
  firstRead: t.Expression,
  secondRead: t.Expression,
): t.ConditionalExpression {
  return t.conditionalExpression(
    t.binaryExpression('!==', firstRead, t.nullLiteral()),
    t.binaryExpression('!==', secondRead, t.unaryExpression('void', t.numericLiteral(0))),
    t.booleanLiteral(false),
  )
}
