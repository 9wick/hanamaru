export interface User { id: string }
export interface CreateUserInput { name: string }

export const userRepository = {
  async save(_input: CreateUserInput): Promise<User> {
    return { id: 'u1' }
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
