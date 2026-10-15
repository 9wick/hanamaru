export type TransportValue =
  | undefined
  | null
  | boolean
  | number
  | bigint
  | string
  | TransportValue[]
  | { [key: string]: TransportValue }
