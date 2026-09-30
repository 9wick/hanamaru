import { equals, iterableEquality, subsetEquality } from '@vitest/expect'

export function equal<T, U>(first: T, second: U): boolean {
  return equals(first, second, [iterableEquality])
}

export function matchObject<T, U>(actual: T, expected: U): boolean {
  return equals(actual, expected, [iterableEquality, subsetEquality])
}
