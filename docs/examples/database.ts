export interface Database {
  countUsers(): Promise<number>
  close(): Promise<void>
}

// サンプル用のメモリDB。3件から始め、close後の読み出しは失敗する。
export async function createDatabase(): Promise<Database> {
  let users = ['Alice', 'Bob', 'Carol']
  let closed = false
  return {
    async countUsers() {
      if (closed) throw new Error('database is closed')
      return users.length
    },
    async close() {
      closed = true
      users = []
    },
  }
}

export function countUsers(db: Database): Promise<number> {
  return db.countUsers()
}
