export interface User { id: string }
export interface CreateUserInput { name: string }
export interface UserRepository { save(input: CreateUserInput): Promise<User> }
export interface Mailer { send(user: User): Promise<void> }

export class UserService {
  readonly #repository: UserRepository
  readonly #mailer: Mailer
  constructor(repository: UserRepository, mailer: Mailer) {
    this.#repository = repository
    this.#mailer = mailer
  }
  async create(input: CreateUserInput): Promise<User> {
    const user = await this.#repository.save(input)
    await this.#mailer.send(user)
    return user
  }
}
