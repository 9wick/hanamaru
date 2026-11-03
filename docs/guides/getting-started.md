# はじめる

このページでは、導入から最初のテスト、middlewareと、直接観測できない場合の代替手段を説明します。まずNode.js 22.18以上で始めます。Bun・Denoでの起動方法は[CLI](../reference/cli.md)を参照してください。

hanamaruを開発依存に追加し、テストを定義してCLIで実行します。最初の例を実行するための設定ファイルは不要です。依存の配布状況とランタイムの制約は[実装状況](../reference/limitations.md)を参照してください。

## インストールする

```console
npm install --save-dev hanamaru@^0.1.0
```

次の2ファイルを `src` 以下へ置けば、最初のテストを実行できます。プロジェクトの `"type"` やtsconfigを変更する必要はありません。
v0.1.0の公開前に試す場合は、以下のローカル配布物を使ってください。

### 公開前のソースから試す

このリポジトリで配布物を作ります。

```console
npm ci
npm pack
```

生成された `hanamaru-0.1.0.tgz` を使い、利用するプロジェクト側で開発依存に追加します。
次の `/path/to` はtarballを置いた実際のパスに置き換えてください。

```console
npm install --save-dev /path/to/hanamaru-0.1.0.tgz
```

次の2ファイルを `src` 以下へ置いて実行します。

## 最初のテスト

対象の `math.ts`。

<!-- example: docs/examples/math.ts -->
```ts
export function add(a: number, b: number): number {
  return a + b
}
```
出典: [docs/examples/math.ts](../examples/math.ts)

同じディレクトリの `math.test.ts`。

<!-- example: docs/examples/math.test.ts -->
```ts
import { Test, registerTest } from 'hanamaru'
import { add } from './math.ts'

export const addition = new Test()
  .target(add)
  .it('2つの数を足す', t => t.args(1, 2).expect(e => [
    e.result.toBe(3),
  ]))

registerTest(addition)
```
出典: [docs/examples/math.test.ts](../examples/math.test.ts)

1. `.target(add)` で対象を渡すと、引数と期待値の型が決まります。
2. `.it()` にケース名を書き、`.args()` に対象の引数を渡します。
3. `.expect()` で期待する条件の配列を返します。
4. 完成した定義を `registerTest` に渡すと、CLIの実行対象になります。

`.args('1', 2)` や `e.result.toBe('3')` は型エラーです。
ケースの識別子や対象ファイルの情報を書く必要はありません。

この例のファイルを `src` 以下に置いた場合、次のコマンドで実行できます。

例の定義は他のサンプルからimportするためにexportしています。CLIでの実行対象は、ファイル末尾の `registerTest(addition)` で指定します。

```console
npx hanamaru src/math.test.ts
```


## 副作用は実際の効果を確かめる

`target(effect(fn))` で副作用を扱う入口を選び、use(environment(...))が渡す観測トークンを期待へ指定します。[環境から登録までのコード例](writing-tests.md#環境と観測)を参照してください。

ユーザー登録なら、targetへ登録情報を渡し、保存されたユーザーと今回届いたメールを観測します。

```text
対象: registerUser
前提: ケース専用のDBとメールボックス
入力: Aliceの登録情報
状態の観測: 登録したユーザーを取得する
状態の期待: 登録情報と一致する
actionの観測: 今回の登録に対応するメールの到着
actionの期待: 宛先・本文・通数が期待と一致する
```

観測の開始はtargetの実行前、状態の読み取りは指定した完了条件の後です。過去のメールや別ケースのデータを含めず、取得に失敗した場合は観測失敗として報告します。準備と後始末はmiddlewareでまとめられます。[期待と観測](../reference/api-expect.md)に記述のルールがあります。

失敗時もtargetの契約に従います。「登録に失敗したら通知しない」なら、不発生を確かめる観測区間を指定します。失敗だから常に状態不変・副作用なしと決めつけません。

## モックを使う

効果の直接観測が困難な場合や外部障害を再現する場合には、環境が許可したinfra境界を代替します。

```text
対象: registerUser
環境が許可した境界: 外部メール配送
境界の設定: 配送要求を拒否する
入力: Aliceの登録情報
期待: 配送失敗時の契約が定める結果・状態
```

任意の関数や内部ヘルパーを差し替えることはできません。代替環境で観測した効果、境界への呼び出し記録、本物の環境での効果は区別します。[infra境界の代替](../reference/api-mock.md)を参照してください。

## middlewareから値を渡す

<!-- example: docs/examples/context.test.ts -->
```ts
import { Test, registerTest, middleware } from 'hanamaru'
import { add } from './math.ts'

export const contextAddition = new Test()
  .target(add)
  .use(middleware(async (_, next) => next({ a: 1, b: 2, expected: 3 })))
  .it('渡された値を使う', t => t
    .argsFrom(ctx => [ctx.a, ctx.b])
    .expect(e => [e.result.toBe(e.ctx.expected)]))

registerTest(contextAddition)
```
出典: [docs/examples/context.test.ts](../examples/context.test.ts)

middlewareは各ケースの各試行で実行します。`next(fields)` に渡した型が `argsFrom` と `e.ctx` に伝わります。
資源の取得と解放を同じ場所に書く場合は、nextをtry / finallyで囲みます。詳しくは[middleware](middleware.md)を参照してください。
共通設定は最初のケース・groupの前に書き、追加した後の変更は型で防ぎます。

## 実行環境とコマンド

対応環境はNode.js 22.18以上・Bun 1.3以上・Deno 2.9.2以上・TypeScript 5.8以上です。[制約](../reference/limitations.md)も参照してください。

設定ファイルがなくても、CLIは `**/*.{test,spec}.ts` を既定の探索対象にします。

読むファイルを名前付きで選ぶ機能は[project](projects.md)、unitとintegration/e2eを分ける構成は[利用例](project-use-cases.md)で説明します。登録とprojectを含むファイル指定・設定は[CLI](../reference/cli.md)を参照してください。

### 任意の型チェック

テスト実行にTypeScriptの追加インストールやtsconfigは必須ではありません。CLIはTypeScriptを変換して実行しますが、型エラーの検出は行いません。
型チェックもしたい場合は、既存のtscコマンドとtsconfigを使ってください。新規プロジェクト向けの設定例を以下に示します。

```console
npm install --save-dev typescript@^5.8
```

`package.json` のscripts例。npmが型チェックとテスト実行を順に起動します。hanamaruが読み込む設定ではありません。

```json
{
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "tsc --noEmit && hanamaru"
  }
}
```

`tsconfig.json` の設定例。

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Preserve",
    "moduleResolution": "Bundler",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true
  },
  "include": ["src/**/*.ts"]
}
```

この例ではソースとテストを `src` 以下に置き、importに `.ts` 拡張子を付けます。
`npm test` で型チェックとテスト実行を続けて行えます。テスト実行だけを登録するなら、`scripts.test` は `"hanamaru"` で構いません。
テストファイルは `registerTest` で登録されたルートだけを実行します。実行に成功すれば終了コード0、テスト失敗なら1、設定・収集のエラーなら2です。CIでは `npx hanamaru --ci` でonlyの混入を検出できます。

複数の定義を合成し、共通設定や環境を用意する場合は[テストをグループにまとめる](grouping.md)を参照してください。

## 入力を並べる・実行設定を変える

入力と期待だけが違うケースには[each](each.md)を使えます。
[timeoutとretry](execution-options.md)はgroup、`.target()` の前後、ケースで設定し、必要な項目だけ上書きできます。
[失敗の表示と結果](../reference/results.md)には宣言位置が自動で残り、IDやソース位置の入力は不要です。
