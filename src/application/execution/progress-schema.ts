import * as v from 'valibot'
import { caseResultSchema, groupMiddlewareSchema, runResultSchema } from '../../domain/result/schemas.js'

export const progressSchema = v.variant('kind', [
  v.object({ kind: v.literal('init'), result: runResultSchema }),
  v.object({ kind: v.literal('case'), result: caseResultSchema }),
  v.object({ kind: v.literal('group'), path: v.array(v.number()), middleware: v.nullable(groupMiddlewareSchema) }),
])
