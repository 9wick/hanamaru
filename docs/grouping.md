# テストをグループにまとめる

`.group()` で関連するテストをまとめます。
グループに書いたmock・setup・useは、その配下のケースに共通して適用します。
名前は必要なときだけ付けられます。

## 関連するテストと共通設定

ユーザーに関するテストをまとめ、作成のテストだけで保存処理をモックする例です。
[groups.test.ts](./examples/groups.test.ts)と[対象のコード](./examples/user.ts)を掲載しています。

```ts
import { Test } from 'hanamaru'
import { createUser, userRepository, mailService } from './user.ts'

export const registrations = new Test()
  .describe('ユーザー')
  .mock(mailService, 'send', m => m.resolves(undefined))
  .group('作成', new Test()
    .target(createUser)
    .mock(userRepository, 'save', m => m.resolves({ id: 'mock-user' }))
    .it('保存して通知する', t => t
      .args({ name: 'Alice' })
      .expect(e => [e.result.toEqual({ id: 'mock-user' })])
      .expectCalls(call => [
        call(mailService, 'send').calledOnceWith({ id: 'mock-user' }),
      ]))
    .it('保存に失敗したら通知しない', t => t
      .mock(userRepository, 'save', m => m.rejects(new Error('save failed')))
      .args({ name: 'Alice' })
      .expect(e => [e.error.toThrow('save failed')])
      .expectCalls(call => [call(mailService, 'send').notCalled()])))
  .group(new Test()
    .target(userRepository, 'save')
    .it('ユーザーを保存する', t => t
      .args({ name: 'Alice' })
      .expect(e => [e.result.toEqual({ id: 'u1' })])))
```

外側のsendのモックは、グループ内の全ケースに適用します。
「作成」のsaveのモックは、その中の2ケースだけに適用します。
隣のsaveのテストでは本物の保存処理を呼ぶため、結果は `u1` です。
さらにケース内のmockで、そのケースだけ振る舞いを上書きできます。

## 名前は任意

`group(child)` なら追加の名前は不要です。
見出しを付けたい場合は `group('作成', child)` と書けます。
名前の有無で設定の範囲は変わらず、一意性も要求しません。
子自身のdescribeや対象名もそのまま保持します。

## 入れ子にして設定の範囲を分ける

```ts
const tests = new Test()
  .group('ユーザー', new Test()
    .mock(mailService, 'send', m => m.resolves(undefined))
    .group(createTests)
    .group(saveTests))
  .group('メール', mailTests)
```

このsendのモックは「ユーザー」の配下だけに適用し、「メール」には適用しません。
mockは外側→内側→ケースの順に重ね、同じオブジェクト・キーでは内側を優先します。
兄弟グループの設定は互いに影響しません。

setup・useもグループの配下だけに適用します。
親から子へ登録順に進み、useの後処理は内側から外側へ戻ります。
準備・後始末はグループ全体で1回ではなく、実行する各ケースの各試行で行います。
ctxと呼び出し記録も各試行で用意します。
資源を使うグループでは[useのmiddleware](./middleware.md)で各ケースを囲めます。

## 親で用意したctxを子へ渡す

グループのsetupやuseで用意した値は、子のargsFrom・e.ctxへ渡ります。
親のctxを使う子は、必要なフィールドを `new Test<Ctx>()` で宣言します。
自分のsetup・useで値を用意する場合、型パラメータは不要です。

次は[user-cases.ts](./examples/user-cases.ts)の例です。

```ts
import { Test } from 'hanamaru'
import { createUser, userRepository, mailService } from './user.ts'

export interface UserContext {
  input: { name: string }
  expectedId: string
}

export const userCases = new Test<UserContext>()
  .target(createUser)
  .setup(ctx => ({ expected: { id: ctx.expectedId } }))
  .it('保存して通知する', t => t
    .argsFrom(ctx => [ctx.input])
    .expect(e => [e.result.toEqual(e.ctx.expected)])
    .expectCalls(call => [call(mailService, 'send').calledTimes(1)]))
  .it('保存に失敗したら通知しない', t => t
    .mock(userRepository, 'save', m => m.rejects(new Error('save failed')))
    .argsFrom(ctx => [ctx.input])
    .expect(e => [e.error.toThrow('save failed')])
    .expectCalls(call => [call(mailService, 'send').notCalled()]))
```

親で必要な値を用意してから子を追加します。

```ts
const tests = new Test()
  .setup(() => ({ input: { name: 'Alice' }, expectedId: 'u1' }))
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .mock(mailService, 'send', m => m.resolves(undefined))
  .group(userCases)

run(tests.plan())
```

不足するフィールドや型違いがあればgroupで型エラーになります。
子の定義時に、後から追加する親の型へ遡って推論されることはありません。
ctxのフィールドは読み取り専用で、setupの戻り値や `next(fields)` で追加・置き換えます。
親のctxを手動でspreadする必要はありません。

## 別ファイルのテストをまとめる

groupには、その場で書いた定義も、importした定義も渡せます。
テストが増えたら、子を別ファイルへ分けて同じグループにまとめられます。

```ts
import { userCases } from './user-cases.ts'

const tests = new Test()
  .setup(() => ({ input: { name: 'Alice' }, expectedId: 'u1' }))
  .group(userCases)
```

ビルダーはイミュータブルです。同じ子を複数のグループへ追加しても、元の定義は変わりません。
それぞれの場所で、親の設定を引き継いで実行します。

## 定義と実行の条件

- groupには、1ケース以上あるテストか、子を持つグループを渡します。
- グループ自体はtarget・ケースを持たず、それぞれの子が対象を持ちます。
- 共通のdescribe・setup・use・mockは最初のgroupより前に書きます。以降はgroupの追加とplanの取得ができます。
- 対象を持つテストをまとめたいときは、新しい親からgroupへ渡します。

`.plan()` は無名のグループも含む階層と、それぞれの設定を保持します。
子の要求ctxを満たさない計画は単独でrunへ渡せません。
CLIには必要なctxを用意したルートだけをexportします。
子は探索対象外のファイルに置き、二重の収集を避けます。
詳細は[型推論](./type-inference.md)、[実行計画](./metadata.md)、[CLI](./cli.md)を参照してください。

## timeoutとretryも継承する

親のgroupで指定したtimeout・retryは配下へ渡り、内側のgroup・target・ケースで項目ごとに上書きできます。
未指定の項目は親の値を保ちます。groupのtimeoutは各試行の期限、retryは失敗したケースの再試行回数です。
グループ全体の時間制限や、成功した兄弟まで再実行する意味にはしません。
[設定例と解決順](./execution-options.md)を参照してください。

setup/useの準備と後始末は各ケースの各試行で行います。グループ全体で1回だけ資源を用意するshared fixtureは初版には含めません。
groupへの追加位置は自動取得し、失敗の詳細と計画・結果の階層へ保持します。詳しくは[宣言位置](./results.md)を参照してください。
