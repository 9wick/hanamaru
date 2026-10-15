export interface CliOptions {
  list?: boolean
  id?: string
  location?: { file: string; line: number }
  filter?: string
  reporter?: string
  config?: string
  projects?: string[]
  collectionTimeout?: number
  shutdownGrace?: number
  ci?: boolean
  failOnFlaky?: boolean
  noColor?: boolean
  help?: boolean
  version?: boolean
}
