import { Test, environment, registerTest } from 'hanamaru'

// 実効果を観測できない境界の妥協は、環境がcall-recordとして明示する。
const boundary = environment(async (_, scope, next) => {
  const requests: { recipient: string }[] = []
  const send = async (recipient: string) => { requests.push({ recipient }) }
  return next({ send, requests: scope.state({ evidence: 'call-record', read: () => requests }) })
})
const requestNotification = async (send: (recipient: string) => Promise<void>, id: string) => send(id)
export const calls = new Test().target(requestNotification).effectful().use(boundary)
  .it('境界へ通知を依頼する', t => t.argsFrom(ctx => [ctx.send, 'u1'])
    .expect(e => [e.state(e.ctx.requests).toEqual([{ recipient: 'u1' }])]))
registerTest(calls)
