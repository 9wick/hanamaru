export interface Store {
  put(key: string, value: string): Promise<void>
  get(key: string): Promise<string | undefined>
}

export function memoryStore(): Store {
  const values = new Map<string, string>()
  return {
    async put(key, value) { values.set(key, value) },
    async get(key) { return values.get(key) },
  }
}

export function objectStore(): Store {
  const values: Record<string, string> = Object.create(null)
  return {
    async put(key, value) { values[key] = value },
    async get(key) { return values[key] },
  }
}
