import { Test, registerTest, middleware } from 'hanamaru'

interface Client {
  send(id: string): Promise<void>
}

registerTest(new Test()
  .use(middleware(async (_, next) => {
    const client: Client = { async send(_id) {} }
    return next({ client, id: 'created-user' })
  }))
  .target((client: Client, id: string) => client.send(id))
  .it('準備したclientが生成したIDで呼ばれる', t => t
    .argsFrom(ctx => [ctx.client, ctx.id])
    .expectCalls(call => [
      call.from(ctx => ctx.client, 'send')
        .calledOnceWithFrom(ctx => [ctx.id]),
    ])))
