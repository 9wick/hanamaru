import { environment } from 'hanamaru'
import { UserService, type CreateUserInput, type UserRepository, type Mailer } from './user.ts'

export function userEnvironment(options: { id?: string; saveFails?: boolean } = {}) {
  return environment(async (_, scope, next) => {
    const rows = new Map<string, CreateUserInput>()
    const inbox = new Map<string, { recipient: string }>()
    const repository: UserRepository = {
      async save(input) {
        if (options.saveFails) throw new Error('save failed')
        const id = options.id ?? 'u1'
        rows.set(id, { ...input })
        return { id }
      },
    }
    const mailer: Mailer = {
      async send(user) {
        if (!rows.has(user.id)) throw new Error('unknown recipient')
        inbox.set(user.id, { recipient: user.id })
      },
    }
    return next({
      users: new UserService(repository, mailer),
      saved: scope.state({ evidence: 'substitute-effect', read: (id: string) => rows.get(id) }),
      delivered: scope.state({ evidence: 'substitute-effect', read: () => [...inbox.values()] }),
    })
  })
}
