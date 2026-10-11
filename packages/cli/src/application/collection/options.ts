export interface CliOptions {
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
