import * as v from 'valibot'
const location = v.object({ file: v.string(), line: v.number(), column: v.number() })
export const targetCatalogueSchema = v.object({
  version: v.literal(1),
  definitions: v.array(
    v.object({ id: v.string(), file: v.string(), origin: location, name: v.string(), rootIndex: v.number() }),
  ),
  cases: v.array(
    v.object({
      id: v.string(),
      definitionId: v.string(),
      name: v.string(),
      origin: location,
      path: v.array(v.number()),
      caseIndex: v.number(),
      mode: v.picklist(['run', 'only', 'skip', 'todo']),
    }),
  ),
})
