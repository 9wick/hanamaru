export interface User { id: string; name: string }
export interface CreateUserInput { name: string }

export const userRepository = {
  async save(input: CreateUserInput): Promise<User> {
    return { id: 'u1', name: input.name }
  },
}
export const mailService = {
  async send(_user: User): Promise<void> {},
}
export async function createUser(input: CreateUserInput): Promise<User> {
  const user = await userRepository.save(input)
  await mailService.send(user)
  return user
}
