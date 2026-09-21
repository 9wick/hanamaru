# テストの合成とスコープ

`group(child)` で、別々に定義したテストをまとめます。
名前は不要です。説明を添えたいときだけ `group(name, child)` と書けます。
親のmockとsetupは、その親の配下にあるケースへ適用します。

## 同じ子を異なるスコープへ合成する

`user-cases.ts`。子は、親から受け取る入力と期待するIDを宣言します。
子のsetupで期待値を作り、失敗ケースだけsaveを上書きします。

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

`groups.test.ts`。親ごとにctxとsaveの振る舞いを用意します。

```ts
import { Test } from 'hanamaru'
import { userRepository, mailService } from './user.ts'
import { userCases } from './user-cases.ts'

const alice = new Test()
  .setup(() => ({ input: { name: 'Alice' }, expectedId: 'u1' }))
  .mock(userRepository, 'save', m => m.resolves({ id: 'u1' }))
  .group(userCases)

const bob = new Test()
  .setup(() => ({ input: { name: 'Bob' }, expectedId: 'u2' }))
  .mock(userRepository, 'save', m => m.resolves({ id: 'u2' }))
  .group(userCases)

export const registrations = new Test()
  .mock(mailService, 'send', m => m.resolves(undefined))
  .group(alice)
  .group('Bobの登録', bob)
```

sendのモックは全4ケースへ、saveの共通モックはAliceとBobのそれぞれ2ケースへ適用されます。
各失敗ケースでは、そのケースだけsaveをrejectへ上書きします。
Aliceのctx・モック・呼び出し記録はBobのケースへ漏れません。
名前を書いていないgroupも同じように設定の境界になります。

## 合成の契約

- 子はケースを持つ完成済みの定義、または子を持つ完成済みのグループです。
- 親はtargetを持たず、それぞれの子が自分のtargetを持ちます。
- 名前の有無はmock・setupの適用範囲を変えません。名前に一意性も要求しません。
- 最初のgroupを追加した後は、親のsetup・mock・describeを変更できません。
- 同じオブジェクト・キーへのmockは、外側の親→内側の親→子→ケースの順で上書きします。
- 合成しても元の子は変わりません。別の親への合成や、兄弟の設定へ影響しません。
- 各ケースでその経路のsetupを実行し、呼び出し記録を作り直し、適用したモックを復元します。

## ctxを親から子へ渡す

独立した子で親のctxを使う場合は、`new Test<Ctx>()` に必要な型を宣言します。
これは親へ要求する型であり、値を生成する操作ではありません。
親が供給できないctxを要求する子の合成は型エラーです。
ctxを自分のsetupだけで用意する定義では、型パラメータは不要です。

setupのcreateは、それまでのctxを受け取り、追加するフィールドをオブジェクトで返します。
同名のフィールドは後のsetupが優先され、他のフィールドは引き継ぎます。
複数のsetupは置き換えず、登録順に実行します。

ケースごとに空のctxから始め、そのケースへ至る親→子の順で拡張します。
ctxのフィールドは読み取り専用で、追加・置き換えはsetupの戻り値を通じて行います。
フィールドが参照するDBやオブジェクト自体は同じものを引き継ぎます。

後始末では、成功したsetupのdisposeを逆順に呼びます。
各disposeには、そのcreateの戻り値を反映した直後のctxを渡します。
ctxの入れ物は各段階で新しくするため、子が同じキーを置き換えても親のdisposeには影響しません。
途中のsetupが失敗した場合も、成功済みのsetupの後始末を行います。

## 合成と実行の型チェック

```ts
// userCasesは親ctxを要求するので、どちらも型エラー。
new Test().group(userCases)
run(userCases.plan())

// 必要なctxを用意したルートから実行する。
run(registrations.plan())
```

間にグループを挟む場合も、そのグループが親に必要な型を宣言します。
子の型が、後から合成した親によって遡って推論されるわけではありません。
同じチェーンでsetupから値を用意する場合は、戻り値から自動で推論します。

`group` は合成を始める前の設定段階、または既に子を持つグループに追加できます。
対象とケースを持つテストをさらにまとめるときは、新しい親からgroupで合成します。
CLIは `groups.test.ts` のルートを収集します。親ctxを要求する `user-cases.ts` は探索対象外に置きます。

## 計画として保持する

`.plan()` は名前のないグループも含めた階層、各階層のsetup・mock、子の計画を保持します。
親の設定を子へ書き戻したり、階層を失う形に平坦化したりしません。
親ctxを要求する子の計画も取得できますが、要求が残る計画は単独でrunへ渡せません。
必要なctxを用意する親へ合成した計画を実行します。

[Test ビルダー](./api-test.md)、[実行計画とmetadata](./metadata.md)、[実行セマンティクス](./semantics.md)に詳細があります。
