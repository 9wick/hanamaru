import { property, valueOf } from './javascript.js'

export function errorMessage<T>(input: T): string {
  const error = valueOf(input)
  return String(error == null ? error : (property(Object(error), 'message') ?? error))
}

export function errorStack<T>(input: T): string {
  const error = valueOf(input)
  if (!(error instanceof Error)) return String(error)
  // Bun 1.3.5の遅延stack生成でも、元のエラー名と理由を確定してから読む。
  const description = Error.prototype.toString.call(error)
  const stack = error.stack
  return stack ? (stack.startsWith(description) ? stack : `${description}\n${stack}`) : description
}
