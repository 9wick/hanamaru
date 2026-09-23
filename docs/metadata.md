# プラグイン向けblueprint

blueprintは、テスト定義から得られる実行前の構造です。プラグイン作者が `test.blueprint()` で取得できます。
グループの階層・テスト対象・middleware・モック・引数・期待の組み立て方などを保持します。ケース名や宣言位置などのmetadataもここから読めます。
通常のテスト実行ではblueprintを取得せず、完成したテストを `run(test)` に渡します。実行計画は実行器の内部で決めます。

## 取得と実行

```ts
import { run } from 'hanamaru'
import type { TestBlueprint } from 'hanamaru'
import { users } from './user.test.ts'

const blueprint: TestBlueprint = users.blueprint()
const result = await run(users)
```

`.blueprint()` は `TestBlueprint` を返します。`run()` は完成したテストを受け取り、実行して `RunResult` を返します。blueprintを直接 `run()` に渡すことはできません。
blueprintを取得してもmiddleware・テスト対象は呼ばず、メソッドの差し替えや記録も開始しません。
対象のファイル・export名・手書きIDの追加登録は不要です。

## blueprintの構造

完全な型契約は[hanamaru.d.ts](./spec/hanamaru.d.ts)を参照してください。

| 構造 | 保持するもの |
|---|---|
| TestBlueprint.version / kind | blueprint形式のバージョンとtest / group |
| TestBlueprint.name | 対象ケース群ではtargetで指定した名前、または省略時の関数名・メソッド名。グループ自身ではnull |
| TestBlueprint.config | そのノードで明示したtimeout・retry。未指定は親から継承 |
| TestBlueprint.steps | そのノードのuseを登録順に並べた配列。未登録なら空配列 |
| MiddlewareBlueprint | kind: middleware、run関数、middlewareの定義で指定したtimeout |
| TestBlueprint.mocks | そのノードの共通モック |
| SuiteBlueprint.target | 関数参照、またはオブジェクト参照・メソッドキー・関数参照 |
| SuiteBlueprint.cases | 宣言順のケース |
| GroupBlueprint.children | 追加した順の子。各要素はname・origin・blueprintを持つ |
| GroupEntry.name | group(name, [children])で追加したまとまりの見出し。省略時と配列内の子ではnull |
| GroupEntry.origin | 子を追加したgroup呼び出しの宣言位置。配列内の各子にも同じ位置を使う |
| GroupEntry.middleware | 子のまとまり全体を一度囲むmiddleware。指定しなければnull。配列内の各子ではnull |
| GroupEntry.blueprint | group呼び出しの追加箇所では子グループ、配列内の追加箇所では渡した子のblueprint |
| Case.name / mode | ケース名とrun / only / skip / todo |
| Case.origin | it / only / skip / todo / eachの宣言位置 |
| Case.row | eachの元の行と0始まりのindex。通常ケースとtodoはnull |
| Case.config | そのケースで明示したtimeout・retry |
| Case.mocks | そのケースで登録したモック |
| Case.args | 引数タプル、またはコンテキストから組み立てる関数 |
| Case.expect | 結果・例外のアサーションをコンテキストから組み立てる処理。省略時はnull |
| Case.calls | 呼び出し条件の記述子の配列。省略時は空配列 |

各モックはobject・key・behaviorを持ちます。
通常のbehaviorはreturns / resolvesと値、throws / rejectsと例外、callsFakeと関数です。
sequenceはkind: sequenceとonceの動作列・fallbackを保持します。
同じスコープ内のobject・keyへのモック設定は最後の振る舞い1件に解決します。
親と子の設定は別々に保持し、実行時に外側→内側→ケースの順で重ねます。
呼び出し条件は複数あっても上書きせず、返された順に全て保持します。

todoは実行本体を持たず、name・mode・origin・config・row: nullを持ちます。
他のケースにはexpectかcallsの少なくとも一方が必要です。
ケース名とグループ名は表示名であり、一意性を要求しません。
結果はblueprintと同じ階層・順・件数で返すため、無名のグループや同名のケースも位置で対応します。

## グループの階層

`TestBlueprint` は対象ケース群を表す `kind: 'test'` のSuiteBlueprintと、グループを表す `kind: 'group'` のGroupBlueprintのunionです。
一回の `group(name, [first, second])` は、親のchildrenに一つの追加箇所を作り、その下の子グループにfirst・secondを順に保持します。子を一つ渡しても同じ階層です。名前と、配列全体を囲むmiddlewareは親から見た追加箇所に保持します。子グループ自体のnameはnullです。
各ノードがその場所のsteps・mocks・configを保持し、子へ設定を書き込むことはありません。
名前のないグループも構造として残ります。

```ts
import { registrations } from './groups.test.ts'

const blueprint = registrations.blueprint()
for (const placement of blueprint.children) {
  const bundle = placement.blueprint
  if (bundle.kind === 'group') {
    for (const entry of bundle.children) {
      const child = entry.blueprint
      if (child.kind === 'group') {
        // 子グループのsteps・mocks・childrenを取得できる。
      } else {
        // 対象ケース群のtarget・casesを取得できる。
      }
    }
  }
}
```

親のコンテキストを要求する子もblueprintを取得できますが、runに渡せるのは親のコンテキストを要求しない完成したルートのテストです。
この区別は型上の契約であり、型引数から実行時のコンテキストスキーマを生成するものではありません。
階層から取り出した子のblueprintは要求型を隠しており、そもそもblueprint自体はrunの入力ではありません。

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

blueprintを受け取った時点で、記録対象の参照とキー、回数や引数の条件が得られます。
実行器はcallsから記録対象を得て、mocksと同じobject・keyなら1つのラッパーにまとめます。
モックがなければ本物の処理、あれば指定した振る舞いを呼び、同じ記録に対して条件を照合します。

この段階ではmiddlewareは未実行です。呼び出し対象と期待する引数は定義時に渡せる値を使います。
middlewareで初めて得る参照や値を、呼び出し条件に使うAPIは現時点では含みません。

## 結果・例外の期待はコンテキストから組み立てる

```ts
new Test()
  .target(add)
  .use(middleware(async (_, next) => next({ a: 1, expected: 3 })))
  .it('渡された値を使う', t => t
    .argsFrom(ctx => [ctx.a, 2])
    .expect(e => [e.result.toBe(e.ctx.expected)]))
```

Case.expectは、このexpectコールバックへコンテキストと記述子ビルダーを渡す `build(ctx)` を保持します。
標準実行器では各試行でテスト対象の呼び出しが終わった後に1回評価し、次の記述子を得ます。

| subject | 対象 | checkの例 |
|---|---|---|
| result | テスト対象の戻り値 | matcher: toEqual、expected: 値 |
| error | テスト対象の例外 | matcher: toBeInstanceOf、ctor: Error |

resultとerrorの混在、空配列は不正です。
errorを返せば例外、resultを返せば正常終了を期待します。expectを省略した呼び出し検証だけのケースも正常終了を期待します。

expectは静的な値だけを使う場合も遅延扱いです。
`.blueprint()` で取得した時点では、expect内部の条件や正常・例外の期待は展開していません。
架空のコンテキストを渡したり、コールバックを試しに実行したりして抽出することはしません。

## 評価時点

| 処理 | 評価時点 | blueprintでの表現 |
|---|---|---|
| itのコールバック | 定義時 | ケースの構造に展開 |
| eachの名前・本体 | 定義時に各行1回 | 行順に通常のケースへ展開 |
| mockの振る舞いコールバック | 定義時 | behaviorに展開 |
| expectCallsのコールバック | 定義時 | callsの記述子に展開 |
| useのmiddleware | 試行開始時にstepsの登録順で入り、nextで後続を実行した後、逆順に戻る | kind: middlewareとrun関数参照 |
| argsFrom | テスト対象の呼び出し前 | kind: from-contextとbuild関数 |
| expectのコールバック | テスト対象の呼び出し後 | kind: deferredとbuild関数 |
| callsFakeの関数 | 対象メソッドの呼び出し時 | 関数参照 |
| toSatisfyの述語 | アサーション評価時 | 記述子内の関数参照 |

middlewareはsteps配列に登録順で保持するため、実行順をblueprintから読めます。
コンテキストとnextを受ける関数と、指定した期限を保持します。前処理・後処理を別の関数へ分解したり、試しに実行してコンテキストを取り出したりはしません。
expectとexpectCallsのチェーン上の順序は、この評価時点を変えません。

## 参照を保持する意味

blueprintはreadonlyですが、利用者が渡した値の内部まで複製・凍結しません。
関数のクロージャ、オブジェクト参照、Error等も保持するため、JSONでの往復は契約に含めません。
宣言位置は自動取得しますが、テスト対象の関数名からその実装位置を特定する保証はありません。
任意の関数内部の依存や分岐は、その関数を保持するだけでは構造として取得できません。

宣言位置・pathによる対応・各試行と失敗の構造は[実行結果](./results.md)に記載しています。
実行設定は[timeoutとretry](./execution-options.md)の規則で解決します。
標準実行器の手順と結果は[実行セマンティクス](./semantics.md)を参照してください。
