# 実行計画とmetadata

hanamaruのmetadataは、テストの実行計画です。
合成の階層・対象・準備・振る舞いの置き換え・引数・期待を、構造化した値として渡します。
そのデータの用途は、受け取る側に委ねます。

## 取得と実行

```ts
import { run } from 'hanamaru'
import { users } from './user.test.ts'

const plan = users.plan()
const result = await run(plan)
```

`.plan()` は `TestPlan` を返し、`run()` が実行して `RunResult` を返します。
計画を取得してもsetup・targetは呼ばず、メソッドの差し替えや記録も開始しません。
対象のファイル・export名・手書きIDの追加登録は不要です。

## 計画の構造

完全な型契約は[hanamaru.d.ts](./spec/hanamaru.d.ts)を参照してください。

| 構造 | 保持するもの |
|---|---|
| TestPlan.version / kind | 計画形式のバージョンとtest / group |
| TestPlan.name | describeの表示名。testでは省略時に対象名、groupではnull |
| TestPlan.setup | そのノードに登録したcreateと任意のdisposeの配列。登録順、未登録なら空配列 |
| TestPlan.mocks | そのノードの共通モック |
| SuitePlan.target | 関数参照、またはオブジェクト参照・メソッドキー・関数参照 |
| SuitePlan.cases | 宣言順のケース |
| GroupPlan.children | 合成した順の子。各要素はnameとplanを持つ |
| GroupEntry.name | group(name, child)の説明。省略時はnull |
| GroupEntry.plan | 子の計画。さらにグループでもよい |
| Case.name / mode | ケース名とrun / only / skip / todo |
| Case.mocks | そのケースで登録したモック |
| Case.args | 引数タプル、またはctxから組み立てる関数 |
| Case.expect | 結果・例外のアサーションをctxから組み立てる処理。省略時はnull |
| Case.calls | 呼び出し条件の記述子の配列。省略時は空配列 |

各モックはobject・key・behaviorを持ちます。
behaviorはreturns / resolvesと値、throws / rejectsと例外、callsFakeと関数のいずれかです。
同じスコープ内のobject・keyへのモック設定は最後の振る舞い1件に解決します。
親と子の設定は別々に保持し、実行時に外側→内側→ケースの順で重ねます。
呼び出し条件は複数あっても上書きせず、返された順に全て保持します。

todoは実行本体を持たず、nameとmodeだけがあります。
他のケースにはexpectかcallsの少なくとも一方が必要です。
ケース名とグループ名は表示名であり、一意性を要求しません。
結果は計画と同じ階層・順・件数で返すため、無名のグループや同名のケースも位置で対応します。

## 合成した計画

`TestPlan` は `kind: 'test'` のSuitePlanと、`kind: 'group'` のGroupPlanのunionです。
各ノードがその場所のsetup・mockを保持し、子へ設定を書き込むことはありません。
名前のないグループも構造として残ります。

```ts
import { registrations } from './groups.test.ts'

const plan = registrations.plan()
for (const entry of plan.children) {
  const child = entry.plan
  if (child.kind === 'group') {
    // child.setup、child.mocks、child.childrenを取得できる。
  } else {
    // child.target、child.casesを取得できる。
  }
}
```

親ctxを要求する子もplanを取得できますが、runに渡せるのは親ctxを要求しないルート計画です。
この区別は型上の契約であり、型引数から実行時のctxスキーマを生成するものではありません。
階層から取り出した子の計画は要求型を隠しているため、そのまま単独でrunへ渡せません。

## 呼び出し条件は定義時に構造化する

```ts
.expectCalls(call => [
  call(mailService, 'send').calledOnceWith({ id: 'u1' }),
])
```

このコールバックは定義時に1回評価します。
`call` とマッチャは検証内容を記述するだけで、send自体は呼びません。
返した記述子がCase.callsに入ります。記述子の主要なフィールドは次のとおりです。

```ts
// 型上のブランドを省略した、記述子の主要なフィールド。
const assertion = {
  subject: 'call',
  object: mailService,
  key: 'send',
  check: { matcher: 'calledOnceWith', args: [{ id: 'u1' }] },
}
```

計画を受け取った時点で、記録対象の参照とキー、回数や引数の条件が得られます。
実行器はcallsから記録対象を得て、mocksと同じobject・keyなら1つのラッパーにまとめます。
モックがなければ本物の処理、あれば指定した振る舞いを呼び、同じ記録に対して条件を照合します。

この段階ではsetupは未実行です。呼び出し対象と期待する引数は定義時に渡せる値を使います。
setupで初めて得る参照や値を、呼び出し条件に使うAPIは現時点では含みません。

## 結果・例外の期待はctxから組み立てる

```ts
new Test()
  .target(add)
  .setup(() => ({ a: 1, expected: 3 }))
  .it('準備した値を使う', t => t
    .argsFrom(ctx => [ctx.a, 2])
    .expect(e => [e.result.toBe(e.ctx.expected)]))
```

Case.expectは、このexpectコールバックへctxと記述子ビルダーを渡す `build(ctx)` を保持します。
標準実行器ではtarget終了後に1回評価し、次の記述子を得ます。

| subject | 対象 | checkの例 |
|---|---|---|
| result | targetの戻り値 | matcher: toEqual、expected: 値 |
| error | targetの例外 | matcher: toBeInstanceOf、ctor: Error |

resultとerrorの混在、空配列は不正です。
errorを返せば例外、resultを返せば正常終了を期待します。expectを省略した呼び出し検証だけのケースも正常終了を期待します。

expectは静的な値だけを使う場合も遅延扱いです。
`.plan()` で取得した時点では、expect内部の条件や正常・例外の期待は展開していません。
架空のctxを渡したり、コールバックを試しに実行したりして抽出することはしません。

## 評価時点

| 処理 | 評価時点 | 計画での表現 |
|---|---|---|
| itのコールバック | 定義時 | ケースの構造に展開 |
| mockの振る舞いコールバック | 定義時 | behaviorに展開 |
| expectCallsのコールバック | 定義時 | callsの記述子に展開 |
| setup.create | ケース開始時、親から子へ、同じ階層では登録順 | ctxから追加フィールドを作る関数参照 |
| argsFrom | targetの前 | kind: from-contextとbuild関数 |
| expectのコールバック | targetの後 | kind: deferredとbuild関数 |
| callsFakeの関数 | 対象メソッドの呼び出し時 | 関数参照 |
| toSatisfyの述語 | アサーション評価時 | 記述子内の関数参照 |
| setup.dispose | 成功済みsetupの逆順で後始末 | 対応するcreate直後のctxを受ける関数参照 |

expectとexpectCallsのチェーン上の順序は、この評価時点を変えません。

## 参照を保持する意味

計画はreadonlyですが、利用者が渡した値の内部まで複製・凍結しません。
関数のクロージャ、オブジェクト参照、Error等も保持するため、JSONでの往復は契約に含めません。
関数名からソースファイルを特定できるとも保証しません。
任意の関数内部の依存や分岐は、その関数を保持するだけでは構造として取得できません。

標準実行器の手順と結果は[実行セマンティクス](./semantics.md)を参照してください。
