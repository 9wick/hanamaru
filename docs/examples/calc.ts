import { getData } from './data.ts'

export function calc(): number {
  return getData() * 2
}
