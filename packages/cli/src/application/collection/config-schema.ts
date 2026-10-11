import * as v from 'valibot'

export const configSchema = v.object({
  vite: v.optional(v.looseObject({})),
  projects: v.optional(
    v.record(
      v.string(),
      v.object({
        include: v.array(v.string()),
        exclude: v.optional(v.array(v.string())),
      }),
    ),
  ),
  reporter: v.optional(v.picklist(['pretty', 'json'])),
  collectionTimeout: v.optional(v.number()),
  shutdownGrace: v.optional(v.number()),
})
