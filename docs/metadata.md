# 実行計画とmetadata

hanamaruのmetadataは、テストの実行計画です。
「何を対象に、どう準備し、どの振る舞いに置き換え、何を渡し、何を検証するか」を構造化した値として渡します。
そのデータの用途は、受け取る側に委ねます。

## 取得と実行

```ts
import { run } from 'hanamaru'
import { users } from './user.test.ts'

const plan = users.plan()
const result = await run(plan)
```

`.plan()` は `TestPlan` を返します。setup・target・期待のコールバックを実行しません。
`run()` は計画を受け取って実行し、別の値である `RunResult` を返します。
定義のために関数やメソッドを渡せば、必要な参照は計画に残ります。
対象のファイル・export名・手書きIDの追加登録は必要ありません。

## 計画の構造

完全な型契約は[hanamaru.d.ts](./spec/hanamaru.d.ts)を参照してください。
次の表は、その読み方です。

| 構造 | 保持するもの |
|---|---|
| TestPlan.version | 計画形式のバージョン |
| TestPlan.name | describeの表示名。省略時は対象名 |
| TestPlan.target | 関数参照、またはオブジェクト参照・メソッドキー・関数参照 |
| TestPlan.setup | createと任意のdispose。省略時はnull |
| TestPlan.cases | 宣言順のケース |
| Case.name / mode | ケース名とrun / only / skip / todo |
| Case.mocks | 共通設定とケース上書きの解決後のモック |
| Case.args | 引数タプル、またはctxから組み立てる関数 |
| Case.expect | ctxを使ってアサーションを組み立てる遅延した処理 |

各モックにはobject・key・behaviorがあります。
behaviorはreturns / resolvesと値、throws / rejectsと例外、callsFakeと関数のいずれかです。
同じobject・keyは1件に解決します。別の参照なら、同じ構造のオブジェクトでも別の登録です。
todoには実行本体がないため、nameとmodeだけがあります。

ケース名は表示のためのもので、一意性は要求しません。
実行結果の配列は入力した計画・ケースと同じ順・同じ件数を保ちます。

## 定義時に確定するものと、実行時に組み立てるもの

```ts
new Test()
  .target(add)
  .setup(() => ({ a: 1, expected: 3 }))
  .it('準備した値を使う', t => t
    .argsFrom(ctx => [ctx.a, 2])
    .expect(e => [e.result.toBe(e.ctx.expected)]))
```

この定義では、対象、setup関数、ケース名、引数を組み立てる関数、期待を組み立てる関数が計画にあります。
ctxや、ctxから取り出した期待値は、setupを実行するまで値として確定しません。

| 処理 | 評価時点 | 計画での表現 |
|---|---|---|
| itのコールバック | 定義時 | ケースの構造に展開 |
| mockの振る舞いコールバック | 定義時 | behaviorに展開 |
| setup.create | ケース開始時 | 関数参照 |
| argsFrom | targetの前 | kind: from-contextとbuild関数 |
| expectのコールバック | targetの後 | kind: deferredとbuild関数 |
| callsFakeの関数 | 対象メソッドの呼び出し時 | 関数参照 |
| toSatisfyの述語 | アサーション評価時 | アサーション内の関数参照 |
| setup.dispose | ケースの後始末 | 関数参照 |

expectは静的な値だけを使っていても、同じ遅延の扱いです。
`.plan()` の時点では、expect内部のマッチャ一覧や正常・例外の期待が展開済みとはしません。
コールバックを試しに実行したり、架空のctxを渡したりして抽出しません。
この境界は、元の `e.ctx` を使う書き方と、定義時にテストを動かさない性質を保つためのものです。

## アサーションの構造

計画の `expect.build(ctx)` は、元のexpectコールバックへctxと記述子ビルダーを渡す処理です。
結果に実際の戻り値や例外は含めず、検証内容の記述子を返します。
標準実行器ではtarget終了後に呼び、次の構造を使って検証します。

| subject | 対象 | checkの例 |
|---|---|---|
| result | targetの戻り値 | matcher: toEqual、expected: 値 |
| error | targetの例外 | matcher: toBeInstanceOf、ctor: Error |
| mock | object・keyで指定した呼び出し記録 | matcher: calledOnceWith、args: 引数タプル |

期待する終了は返された配列から決まります。errorを含めば例外、含まなければ正常終了です。
resultとerrorの混在、空配列、不正なモック参照は不正な期待です。
記述子を作る処理と、実際の結果へ照合する処理も分かれています。

## 参照を保持する意味

計画はreadonlyな構造ですが、利用者が渡した値の内部まで複製・凍結しません。
関数のクロージャ、オブジェクト参照、Error等も保持するため、JSONでの往復は契約に含めません。
関数名からソースファイルを特定できるとも保証しません。
任意の関数内部の依存や分岐は、その関数を保持するだけでは構造として取得できません。

標準実行器の手順と結果は[実行セマンティクス](./semantics.md)を参照してください。
