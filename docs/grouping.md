# テストをグループにまとめる

`.group()` で関連するテストをまとめます。
グループに書いたmock・useは、その配下のケースに共通して適用します。
名前は必要なときだけ付けられます。

## 関連するテストと共通設定

ユーザーに関するテストをまとめ、作成のテストだけで保存処理をモックする例です。
[groups.test.ts](./examples/groups.test.ts)と[対象のコード](./examples/user.ts)を掲載しています。

```ts
import { Test } from 'hanamaru'
import { createUser, userRepository, mailService } from './user.ts'

const creation = new Test()
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
    .expectCalls(call => [call(mailService, 'send').notCalled()]))

const saving = new Test()
  .target(userRepository, 'save')
  .it('ユーザーを保存する', t => t
    .args({ name: 'Alice' })
    .expect(e => [e.result.toEqual({ id: 'u1' })]))

export const registrations = new Test()
  .mock(mailService, 'send', m => m.resolves(undefined))
  .group('作成', [creation])
  .group([saving])
```

外側のsendのモックは、グループ内の全ケースに適用します。
「作成」のsaveのモックは、その中の2ケースだけに適用します。
隣のsaveのテストでは本物の保存処理を呼ぶため、結果は `u1` です。
さらにケース内のmockで、そのケースだけ振る舞いを上書きできます。

## group全体をmiddlewareで囲む

`group(middleware, [children])` は、渡した子のまとまり全体を一度だけmiddlewareで囲みます。

```ts
export const tests = new Test()
  .group(middleware(async (_, next) => {
    const server = await startServer()
    try {
      return await next({ server })
    } finally {
      await server.stop()
    }
  }), [createUserTests, deleteUserTests])
```

実行順は次の形です。

```text
startServer
  createUserTests の各case/attempt
  deleteUserTests の各case/attempt
stopServer
```

通常の `.use()` は各attemptを囲み、`group(middleware, [children])` のmiddlewareは子のまとまり全体を一度だけ囲みます。
middlewareが `next({ server })` へ渡したフィールドは、全子の要求コンテキストとして型検査され、各子のattemptのコンテキストから参照できます。
同じ子を別のgroupへ追加した場合は、追加箇所ごとに独立してmiddlewareを実行します。

group middlewareは共有資源のlifetimeを表します。配下のcaseが互いの実行結果や状態に依存してよいことを意味しません。
順序を持つ一連の操作はflowとして表し、group middlewareによる共有資源の管理とは区別します。

group middlewareの前処理が失敗した場合、渡した全子の実行は開始せず、配下の実行対象caseをcancelledとしてrunを失敗させます。
通常の例外で復元・後処理が完了した場合は、そのgroupの外の後続を続行し、runはfailed / completedです。caseの試行を捏造せず、失敗はgroup middlewareの結果に残します。
後処理が失敗した場合もrunを失敗させ、片付いていない共有状態を次のgroupへ持ち越さないため後続の実行を中断します。
前処理・後処理の期限は `middleware(fn, { timeout })` で指定します。どちらの超過もrunをfailed / timeoutとし、group外も含めて後続を中断します。
通常のcase失敗やretryではgroup middlewareを作り直さず、子全体の実行が終わるまで同じ共有資源を保持します。

名前を付ける場合は `group(name, middleware, [children])` と書けます。

## group開始前に必要な値

`new Test<R, G>()` のRは各attemptで親に要求する値、Gはgroup開始前に親に要求する値です。どちらも省略時は `{}` です。
通常の `.use()` はRから始まる各attemptのコンテキストを読み、group middlewareはGを読みます。
Gを供給できるのは外側のgroup middlewareです。各attemptで動く親の `.use()` は、子のgroup前処理より後なのでGを供給できません。

```ts
const expectedChild = new Test<{ expected: number }>()
  .target((value: number) => value)
  .it('groupが渡す期待値', t => t.argsFrom(ctx => [ctx.expected])
    .expect(e => [e.result.toBe(e.ctx.expected)]))

const seededGroup = new Test<{}, { seed: number }>()
  .group(middleware(async (ctx, next) =>
    next({ expected: ctx.seed + 1 })), [expectedChild])

const tests = new Test()
  .group(middleware(async (_, next) => next({ seed: 2 })), [seededGroup])
run(tests)
```

親を `.use(middleware(async (_, next) => next({ seed: 2 }))).group([seededGroup])` に変えると型エラーです。
名前付きgroup、入れ子、複数の子、同じ子の再利用でもこの検査を行います。間のグループもGを宣言して引き継ぎます。
group middlewareの追加フィールドは、そのgroupの子について各attemptの要求とgroup開始前の要求の両方を満たせます。同じチェーンの兄弟groupには渡しません。
Gにだけ書いた値を各attemptでも読みたい場合はRにも宣言します。Rだけの要求は、従来どおり親の `.use()` で満たせます。

## 名前は任意

`group([children])` ならグループの名前は不要です。
名前を付けたい場合は `group('作成', [children])` と書けます。middleware付きでも `group(middleware, [children])` / `group('作成', middleware, [children])` の同じ規則です。
子が一つでも配列で渡します。空配列は完成したグループになりません。
名前の有無で設定の範囲は変わらず、一意性も要求しません。
子の対象ケース群の名前もそのまま保持します。`new Test()` はグループを作らず、各 `group()` 呼び出しが名前付きまたは無名のグループを作ります。

```ts
const tests = new Test()
  .group('基本', [addition, subtraction])
  .group('再確認', [addition])
```

「基本」はadditionとsubtractionを包む一つのグループです。「再確認」は別のグループで、同じadditionをもう一度含みます。additionの定義は変わらず、二つの実行箇所はそれぞれの経路の設定で実行します。

## 入れ子にして設定の範囲を分ける

```ts
const inner = new Test().group('内側', [addition])
const outer = new Test().group('外側', [inner])
```

この実行階層は「外側 → 内側 → additionの対象ケース群」です。二つの `new Test()` は定義の起点であり、階層を増やしません。

```ts
const userGroup = new Test()
  .mock(mailService, 'send', m => m.resolves(undefined))
  .group([createTests, saveTests])

const tests = new Test()
  .group('ユーザー', [userGroup])
  .group('メール', [mailTests])
```

このsendのモックは「ユーザー」の配下だけに適用し、「メール」には適用しません。
mockは外側→内側→ケースの順に重ね、同じオブジェクト・キーでは内側を優先します。
兄弟グループの設定は互いに影響しません。

useのmiddlewareもグループの配下だけに適用します。
親から子へ登録順に進み、後処理は内側から外側へ戻ります。
middlewareはグループ全体で1回ではなく、実行する各ケースの各試行で動きます。
コンテキストと呼び出し記録も各試行で用意します。
資源を使うグループでは[useのmiddleware](./middleware.md)で各ケースを囲めます。

## 親で用意したコンテキストを子へ渡す

グループのuseで用意した値は、子のargsFrom・`e.ctx`へ渡ります。
親のコンテキストを使う子は、必要なフィールドを `new Test<Ctx>()` で宣言します。
自分のuseで値を用意する場合、型パラメータは不要です。

次は[user-cases.ts](./examples/user-cases.ts)の例です。

```ts
import { Test, middleware } from 'hanamaru'
import { createUser, userRepository, mailService } from './user.ts'

export interface UserContext {
  input: { name: string }
  expectedId: string
}

export const userCases = new Test<UserContext>()
  .target(createUser)
  .use(middleware(async (ctx, next) => next({ expected: { id: ctx.expectedId } })))
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
  .use(middleware(async (_, next) => next({ input: { name: 'Alice' }, expectedId: 'u1' })))
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .mock(mailService, 'send', m => m.resolves(undefined))
  .group([userCases])

run(tests)
```

不足するフィールドや型違いがあればgroupで型エラーになります。
子の定義時に、後から追加する親の型へ遡って推論されることはありません。
コンテキストのフィールドは読み取り専用で、`next(fields)` で追加・置き換えます。
親のコンテキストを手動でspreadする必要はありません。

## 別ファイルのテストをまとめる

groupには、その場で書いた定義も、importした定義も渡せます。
テストが増えたら、子を別ファイルへ分けて同じグループにまとめられます。

```ts
import { userCases } from './user-cases.ts'

const tests = new Test()
  .use(middleware(async (_, next) => next({ input: { name: 'Alice' }, expectedId: 'u1' })))
  .group([userCases])
```

ビルダーはイミュータブルです。同じ子を複数のグループへ追加しても、元の定義は変わりません。
それぞれの場所で、親の設定を引き継いで実行します。

## 定義と実行の条件

- groupには、1ケース以上ある対象ケース群か、子を持つグループを、空でない配列で渡します。
- グループ自体はテスト対象・ケースを持たず、それぞれの子がテスト対象を持ちます。
- 共通のuse・mockは最初のgroupより前に書きます。以降はgroupの追加とblueprintの取得ができます。
- 対象を持つテストをまとめたいときは、新しい親からgroupへ渡します。

プラグイン向けの `.blueprint()` は無名のグループも含む階層と、それぞれの設定を保持します。
子の要求コンテキストを満たさないテストは単独でrunへ渡せません。
CLIには必要なコンテキストを用意したルートだけをexportします。
子は探索対象外のファイルに置き、二重の収集を避けます。
詳細は[型推論](./type-inference.md)、[プラグイン向けblueprint](./metadata.md)、[CLI](./cli.md)を参照してください。

## timeoutとretryも継承する

親のgroupで指定したtimeout・retryは配下へ渡り、内側のgroupの共通設定、対象ケース群の共通設定、ケース個別の設定で項目ごとに上書きできます。
未指定の項目は親の値を保ちます。groupで指定したtimeoutは配下の各ケースの試行期限、retryは失敗したケースの再試行回数です。
グループ全体の時間制限や、成功した兄弟まで再実行する意味にはしません。
[設定例と解決順](./execution-options.md)を参照してください。

useのmiddlewareは各ケースの各試行を囲みます。`group(middleware, [children])` のmiddlewareだけは、そのグループの子全体を一度囲みます。
groupへの追加位置は自動取得し、blueprintと実行結果の階層へ保持します。詳しくは[宣言位置](./results.md)を参照してください。
