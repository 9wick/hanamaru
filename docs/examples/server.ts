export interface Server {
  request(path: string): Promise<number>
  stop(): Promise<void>
}

// サンプル用のメモリサーバー。/users だけを提供し、stop後の要求は失敗する。
export async function startServer(): Promise<Server> {
  let running = true
  return {
    async request(path) {
      if (!running) throw new Error('server is stopped')
      return path === '/users' ? 200 : 404
    },
    async stop() {
      running = false
    },
  }
}

export function request(server: Server, path: string): Promise<number> {
  return server.request(path)
}
