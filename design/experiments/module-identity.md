# 自然なmodule mockからworker実行までの成立性検証

> 2026-09-24の実験記録。当時の実験worktreeにあった `CONTRACT.md` と `RESULTS.md` を一つにまとめたものです。
> runnerスクリプト（`*.mjs`、`matrix.py`）と生ログ（`results-*.json`）は保存していません。
> 本文中の作業ディレクトリ・隣接worktree・再現コマンドは現在のリポジトリでは成立せず、当時の条件の記録として残しています。

## 目的

ユーザーが通常のimportとmock対象の指定を記述し、その定義からmodule識別・全件準備・attempt実行までつながるかを実測する。前回のURL明示PoCの成功を、この目的の達成とは扱わない。

## 検証前の契約

- 既存のnamespace object + keyを出発点にする。新しい公開APIの確定は行わない。
- 頭脳で読み込みを観測し、moduleの解決済みURLと実際のnamespace objectを対応付ける。ユーザーのソース変換・関数文字列化・ソース文字列からのパス推測はしない。
- 頭脳がblueprintを保持し、手足には全mock対象とattemptの指定だけを渡す。fake/target/expectは手足の再評価で得る。
- blueprint収集時はmockを発動させない。再評価可能な定義を前提とし、収集時の無害な副作用の一致検査はしない。
- 一attemptのfake/spy・復元、静的named import・namespace import・in-source targetを試す。
- Node 22.18 / 24.14とBun 1.3.5で同じfixtureを実行し、実行結果が一致するかを調べる。
- 成功も失敗もコマンドと結果を保存する。未検証は明示する。既知の失敗を黙って除外したり、内部APIにfixtureを書き換えて成功扱いしない。

## 破壊を試みる入力

1. namespaceの別名、helperに渡してmockを組み立てる、動的に作ったspecifierのimport。
2. 再exportされた関数、default、TypeScript、bare package import、同名の別module。
3. あるmock対象moduleが別mock対象moduleをimportするDAG。準備リストの順序を逆転。
4. mock対象同士の循環依存。ロード時呼び出し・値の捕捉。
5. 本物→fake→本物、失敗後の復元、spyのみ、複数attemptのworker再利用。
6. module内のlexical呼び出しとmodule境界を跨ぐimportを区別する。

このfixture集合の成功は全JavaScript・全実行環境での普遍的保証ではない。成立した仕組みと具体的な反例により、採用可否の根拠を得る。

## 反例後の追加仮説

逐次の本物import→mock登録は、依存moduleが先に本物を参照する反例がある。依存順に準備する案と、全関数exportの差し替え口を先に登録してから別query URLで本物を読む案を比較する。後者はユーザーのソース本文を変更しないがmodule identityを変えるため、自己import・非関数export・live binding・ロード時呼び出しも反例として試す。失敗しても元のfixtureの期待値を緩めない。

さらに、native mock.moduleのexportコピーを使わず、loaderでフレームワーク側の中継moduleを生成する案を検証する。元のソース本文と元moduleのURLは維持し、非mock対象のexportは元moduleからre-exportしてlive bindingを保つ。mock対象だけをslot参照する関数としてexportする。元module読み込み用specifierだけは内部loaderで別扱いし、通常の依存importは全件登録済みの中継moduleへ向ける。これはユーザーソースの変換をしないが、中継コード生成とランタイム別loader実装は必要な方式である。

Bunのbare package importでhookが呼ばれない現象について、頭脳と手足のworker間で解決キャッシュを共有する影響かを切り分けるため、同じjobと初期データを独立processへ渡す対照実験も行う。ユーザーfixtureや期待値は同一とする。

resolve観測だけで見えないBunのpackage importに対し、onLoadで元ファイルの内容をそのまま返す観測も試す。ソースを書き換えず、識別の改善と実行時の中継への切り替えは別々に検証する。

## 検証結果: module mockの成立性（成功・反例・未解決点）

要求全体は未達成。前回の「PoC成功を根拠に本体へ組み込んでよい」という判断を撤回する。部分的な成功を採用判断へ拡大しない。

### 今回分かったこと

1. ユーザーにmodule URLを書かせることは必須ではなかった。読み込み時に観測したURLとnamespace objectを同一性で照合し、通常の `.mock(data, 'getData', ...)` から準備一覧を作れる。fake関数の転送・ユーザーのソース変換は行っていない。
2. 前回本体に入れたnative mock backendには実際の反例がある。Nodeでは準備順序とlive bindingが壊れる。下記core matrixは実験用の類似コードではなく、`hanamaru-attempt-queue/src/module-reference.js` の実装を直接実行している。
3. 順序変更だけでは循環依存を解決できない。全mockを先に登録してquery付きURLで本物を読む方式も、ロード時呼び出し・class identity・live binding・Bunのtimeoutで失敗した。
4. 元moduleをそのまま読み込み、非mock exportをre-exportし、mock関数だけを中継するloader方式はNode 22/24で47 attemptの期待結果が一致した。中継コードはフレームワークが生成する。ユーザーソース本文・元moduleのimport.meta.urlはそのまま維持する。
5. 同じloader方式のBun実装には未解決の失敗がある。1.3.5では実行時にクラッシュし、1.4.2ではpackage名importの介入が漏れる。別processに分けても再現した。これを「どこでも動く」とは扱えない。

### ユーザーが書くfixture

fixtures/suites.mjsは実際のTest APIを使っている。URLや内部slotは書いていない。

```js
import * as data from './data.mjs'
import { calc } from './calc.mjs'

new Test().target(calc)
  .it('fake', t => t
    .mock(data, 'getData', m => m.returns(7))
    .args()
    .expect(e => [e.result.toBe(70)]))
```

頭脳はTestのblueprintを保持し、全件の対象を抽出する。手足へは解決したmodule情報とpath/attempt番号を送り、手足で再評価したローカル関数を実行する。本体のcollectBlueprints/createPlan/runPlan/executeAttemptを利用する。experimentのworkerはgroup通信・timeout回収等を本体workerから全て移植したものではない。

### 再実行

作業ディレクトリ: `/workspaces/github.com/9wick/hanamaru-module-mock-poc`

隣の `hanamaru-attempt-queue` worktreeにある未commitのrunner実装を利用する。Node 24.14.0、VoltaからNode 22.18.0、Bun 1.3.5、npxからBun 1.4.2を使った。既存のBunは更新していない。matrixはfixtureのローカルpackage symlinkを自動作成する。

| コマンド | 成功したコマンド数 | 失敗したコマンド数 | 終了コード |
| --- | ---: | ---: | ---: |
| `python3 experiments/module-identity/matrix.py native` | 32 / 48 | 16 | 1 |
| `python3 experiments/module-identity/matrix.py loader` | 33 / 37 | 4 | 1 |
| `python3 experiments/module-identity/matrix.py alternatives` | 18 / 31 | 13 | 1 |
| `python3 experiments/module-identity/matrix.py observation` | 4 / 8 | 4 | 1 |
| `python3 experiments/module-identity/matrix.py core` | 4 / 8 | 4 | 1 |

合計132コマンド: 91成功、41失敗。反例を成功扱いに変えるためのexpected failure指定はしていない。各matrixは失敗があると終了コード1になる。唯一の意図的なassertion失敗caseはfixtureのintentional-failureで、次のattemptで復元を確認するために名前を明示している。

全コマンド・stdout・stderr・終了コード・各attempt結果を `results-native.json` / `results-loader.json` / `results-alternatives.json` / `results-observation.json` / `results-core.json` に保存した。Bunのtimeoutやクラッシュはattemptに到達しない失敗として残している。

### 具体的な反例

#### 本体backend: 依存先のmockが効かない

AがB.bをimportし、a()がb()+10を返す。Aを準備してからBを準備し、B.bを5へ変える。

```sh
node --experimental-test-module-mocks experiments/module-identity/core-backend-probe.mjs dag
```

Node 22/24: 期待15、実際11、終了コード1。Bun 1.3.5/1.4.2: 15、終了コード0。依存順にする案はこのDAGを直せるが、cycle-suitesの循環には順序を定義できない。

#### 本体backend: mockしていないexportまで壊れる

getDataだけを準備するmoduleに `export let count = 0` と `increment()` がある。

```sh
node --experimental-test-module-mocks experiments/module-identity/core-backend-probe.mjs live-binding
```

Node 22/24: increment後の期待1、実際0、終了コード1。Bun 1.3.5/1.4.2: 1、終了コード0。

#### Bun: package名importの観測と介入は別問題

resolve hookだけの観測ではpackage自己参照・node_modules経由のpackageを特定できないfixtureがある。onLoadで元の内容をそのまま返す観測を追加すると、両方のBunで特定でき、native backendならfakeと復元も通る。

```sh
bun experiments/module-identity/verify.mjs ./fixtures/pkg/suite.mjs --observe-load
npx --yes bun@1.4.2 experiments/module-identity/verify.mjs ./fixtures/pkg/suite.mjs --observe-load
```

いずれも2 attemptの期待結果が一致し終了コード0。しかし `--loader` も付けるとreadonly propertyへの代入で失敗する。識別だけを直しても実行側の介入漏れは直らない。通常のnode_modules packageでも同様。`--loader --process` でも自己参照の失敗は残る。

### 新loader方式で確認した範囲

Node 22.18 / 24.14は12 fixture・47 attempt全ての期待結果が一致した。

- 静的named import・namespace import・default・再export・別名・helperを経由したmock。
- 計算したspecifierでの動的import、in-source target、関数参照の捕捉とbind、同名の別module。
- TypeScript、package自己参照、node_modules経由のpackage、CJSをESMからimport、top-level await。
- mock対象間のDAG・循環・循環中のロード時呼び出し、準備順の逆転。
- mockしていないexport let・class instanceof・関数を含む非cloneable export・import.meta.urlの維持。
- fake・spy・意図的な失敗後の復元、同じ実行workerの再利用。

Bun 1.4.2は同じ12 fixtureのうち9 fixture成功。43 attemptを実行し、1 attemptが期待外の失敗、2 fixtureはmodule識別段階で停止した。onLoad観測の追加検証では識別段階の停止は解消するが、mock実行の失敗へ進むため要求達成にはならない。

### 目的達成の確認

- 事実: experiments配下に識別・3種の準備方式・worker配送・比較matrixを作成。本体コードはこの検証で変更せず、本体の設計メモとissueの完了判断を訂正した。
- 目的との接続: 自然な記述からmodule識別までの経路は実証できた。通常の直接import mockも成立する。しかしランタイム・import形式に左右されない実行には既知の反例が残る。
- 仮定の訂正: 「URLを明示させないと識別できない」は誤り。「全件準備すれば読み込み問題は解ける」も、元moduleを準備中に読む順序とlive bindingを考慮しない限り誤り。利用者体験の目的は維持し、成功条件を狭めて合格にしない。
- 完了判定: **追加作業が必要。本体統合issue 672f609aは再open。** 新方式は候補であり、本体へ採用済みではない。
- 次の技術課題: Bunでpackage名importを含めて中継を確実に通し、元moduleの意味を保てるloader経路。既知の反例が残るbackendを黙って選ぶfallbackは採用しない。

未検証: ブラウザ/Deno/Windows、全Node/Bunバージョン、任意のユーザーloader併用、条件付きpackage exports、requireによる呼び出し、mock対象class自体、module内lexical呼び出しの置換、module識別の全ファイル形式、性能、今回の識別方式と本体group/timeout/interrupt処理の統合。実験が全てのJavaScriptプログラムの可否を証明したとは扱わない。
