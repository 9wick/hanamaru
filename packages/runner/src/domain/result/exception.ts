import { property, valueOf } from '../execution/javascript.js'

export function errorMessage<T>(input: T): string {
  const error = valueOf(input)
  return String(error == null ? error : (property(Object(error), 'message') ?? error))
}

export function errorStack<T>(input: T): string {
  const error = valueOf(input)
  return String(error instanceof Error ? (error.stack ?? error.message) : error)
}
