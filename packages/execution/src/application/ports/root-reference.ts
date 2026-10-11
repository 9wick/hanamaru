import type { SourceLocation } from '@hanamaru/blueprint/model'

export interface RootReference {
  file: string
  index: number
  origin: SourceLocation
}
