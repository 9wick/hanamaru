# Resource

テストが必要とする共有環境を `resource({ scope, require, setup })` で定義し、
case・target・groupのチェーンで `.require(resource)` と宣言する。
カテゴリに依存せず、選択された実行可能なcaseが要求する依存graphだけを準備する。

## 契約

- `scope` は必須で `perRun` または `perWorker`。利用側はscopeを選ばない。
- 同じ定義値は同じscope内で一度だけ準備する。factoryの呼び出しで作った別定義は別資源。
- `require` は明示的な依存。`setup(ctx, next)` のctxは直接依存の供給値だけ。
  通常のmiddlewareからのcontextは受け取らない。
- 循環とperRunからperWorkerへの依存は、副作用を起こす前にエラーにする。
- 利用側には直接要求したresource自身の供給値のみ公開する。
  依存先の値を再公開する場合はsetupのnextへ明示的に含める。
- 異なるresourceからの同名キーはエラー。同じresourceの重複要求は冪等。
  通常のmiddlewareによるcontextの上書きは既存の規則に従う。
- nextは一度だけ呼び、その完了値をreturnする。後処理は `return await next(...)` を
  try/finallyで囲んで記述する。前処理・後処理のtimeoutはmiddlewareと同様に独立。
- 供給値はプレーンなobjectを起点とするJSON相当のデータ。
  null・boolean・string・有限number・密なarray・プレーンobjectを許す。
  undefined・非有限数・負のゼロ・bigint・symbol・function・独自prototype・accessor・循環参照・
  JSON化で失われる追加プロパティを拒否する。変換や欠落で成功扱いにしない。
- 供給値は検証時に複製する。依存setupのctxは深くfreezeし、consumerへは実行ごとに複製する。
- setupはbrain側で依存順に先行実行し、実行workerには供給データだけを送る。
  perWorkerは実行workerごとの寿命を表す。現行の実行workerは1つ。
- retryでもresourceは再準備しない。別runでは新しく準備する。
- setup失敗時はその資源を必要とするcaseをcancelし、独立caseを継続。
  resource自身の結果を報告し、runを失敗扱いにする。
- cleanupは依存の逆順。実行workerのcleanup・終了後にresourceを解放する。
  timeout・cleanup失敗はrunを打ち切る。中断時も既に開いた資源の後処理を試みる。

## 使用例

<!-- example: docs/examples/resources.test.ts#lifecycle -->
```ts
const database = resource({
  name: 'database',
  scope: 'perRun',
  async setup(_, next) {
    const db = await startDatabase()
    try {
      return await next({ databaseUrl: db.url })
    } finally {
      await db.stop()
    }
  },
})

const schema = resource({
  name: 'schema',
  scope: 'perWorker',
  require: [database],
  async setup(ctx, next) {
    const created = await createSchema(ctx.databaseUrl)
    try {
      return await next({ schemaUrl: created.url })
    } finally {
      await created.drop()
    }
  },
})

const queries = new Test().require(schema).target(query)
  .it('query', t => t.argsFrom(ctx => [ctx.schemaUrl]).expect(e => [e.result.toBe(1)]))
```
出典: [docs/examples/resources.test.ts](../examples/resources.test.ts)

resourceの結果はrunの `resources` に、各定義の `id`・`name`・`scope` とmiddlewareと同じ形の実行結果を記録する。
`name` と `timeout` はresource定義の省略可能な設定。
