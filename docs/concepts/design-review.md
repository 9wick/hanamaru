# 仕様改訂の判断記録

このページはレビュー後の採否を残す記録です。
ユーザーとの公開契約はREADMEと下記の各ページ、および[型契約](../spec/hanamaru.d.ts)に記載しています。
ビルダー・ランナー・CLIのローカル実装があり、検証済みの範囲と残る制約を[実装状況](../reference/limitations.md)で区別します。

## 採用した契約

| 項目 | 判断と公開仕様 |
|---|---|
| 宣言位置 | it等とgroupの位置を自動取得する。失敗時は位置を表示し、成功時もデータに保持する。[実行結果](../reference/results.md) |
| identity | 収集したblueprint内のpathで区別し、手書きIDを要求しない。編集をまたぐ同一性やテスト対象の実装位置は保証に含めない。[実行結果](../reference/results.md) |
| 構造化した失敗 | 条件・期待・観測・原因を保持する。JSONでも特殊な値を区別する。[実行結果](../reference/results.md) |
| timeout / retry | group、`.target()` の前後、ケースで指定し、項目ごとに継承・上書きする。全試行を結果へ残す。[実行設定](../guides/execution-options.md) |
| each | each(name, rows, body)をitと並ぶ入口にする。[each](../guides/each.md) |
| mock sequence | onceを順に指定し、最後に通常動作を必須とする。[モック](../reference/api-mock.md) |
| nth | 指定メソッドのn回目の引数を検証する。spy登録を要求しない。[マッチャ](../reference/api-expect.md) |
| middleware | `middleware(fn, { timeout })` で作り、関数のままでは登録できない。ケースへ値を渡す手段は `next(fields)` だけにする。[middleware](../guides/middleware.md) / [用語集](glossary.md) |
| 前処理期限・後処理期限 | middlewareの定義に持たせ、前処理と後処理へ独立に適用する。既定値は10,000ms。[middleware](../guides/middleware.md) |

軽量なチェーン、値と状態遷移の型安全、テスト定義と実行の分離を保ちます。
通常のテスト実行はCLIから行います。CLIはテストファイルで登録した完成定義を収集します。自分のプログラムから定義を実行して結果を処理する入口として `run(test)` を提供します。blueprintはプラグイン作者に公開し、実行計画は実行器の内部で決めます。

## expectの書き心地を維持する

e.fromで期待値ごとにコールバックを追加する案は撤回しました。
`e.ctx`を含む現行の書き方を保ち、expectを遅延処理として公開します。
実行前に全matcher・正常/例外の期待を得ることは初版の保証に含めません。
事前構造化をさらに進める方式は継続検討ですが、未決の案を現在の契約として扱いません。
[プラグイン向けblueprint](../reference/metadata.md)が現在の約束です。

## 今回含めないもの

- 時計の制御は次verで扱います。
- process・run単位の共有資源の管理、呼び出しの順序・部分一致、watch・coverage・parallel・shardingは後続です。
- flowは今回の計画外です。操作記述・値の受け渡し・実行単位を今回確定しません。
- each専用のonly/skip/todo表記は未採用です。通常のonlyとCLIのfilterは展開後のケースに作用します。
- signal、custom matcherの登録API、タグ・注記、snapshotは追加しません。
- module mockは初版に含めず、オブジェクトのメソッド境界を保ちます。

後続設計は[複数呼び出しの契約案](../guides/multiple-calls.md)と[flowの検討範囲](../guides/flow.md)に分けて説明します。どちらも未実装で、現在の公開契約への追加ではありません。設計上の採否と未決事項は下記の判断記録に残します。

既存の条件は通常の関数で組み合わせられるため、そのためだけの専用登録APIや再利用ドキュメントは追加しません。
シナリオ全体を匿名のテスト対象関数へ包む推奨例も取り下げています。

## 契約を具体化する際の整理

設定は各階層のconfigへ明示値だけを残し、実行結果には解決済みの値を返します。
DiagnosticValueのkindで、undefined・特殊な数値・参照等をJSONでも区別します。
アサーションはexpect / expectCallsと、それぞれの配列内の位置で対応させます。
復元・後始末を完了できない場合は後続を中断し、片付いていない状態を次のケースへ渡しません。
これらも各公開ページと型契約の一部です。

## ケースの結果は試行から求める

CaseResult.failuresは各試行のfailuresと重複するため削除しました。status・flakyも派生値として保持しません。
実行済みケースの結果はattemptsへ一本化し、試行がないケースにだけnotRunでskip・todo・実行前中断を記録します。
表示とrunの集約は、同じ試行の記録から必要な値を計算します。[実行結果](../reference/results.md)に規則を記載しています。

## 中断時の状態とCLIの時間制限

[終了状態の表](../reference/results.md#終了状態の表)で、試行・ケースの派生値・run・後続ケースを定めます。
timeoutとcleanup失敗はfailed、失敗がないまま割り込まれた試行はcancelledです。既存の失敗を消さず、複数の中断原因の優先順位も固定します。
収集期限と終了猶予は[CLIの設定](../reference/cli.md#時間制限)で変更可能にしました。30,000msと1,000msは未指定時の既定値であり、全プロジェクトに強制する時間ではありません。

## caseの独立性と実行境界

caseは他のcaseの実行有無・実行順に依存しない独立した実行単位とします。初版が宣言順に直列実行しても、その順序は利用者が依存する契約にはしません。将来のshuffle・parallel・複数process配置を許せる意味論にします。

実行モデルは Run > Process * N とします。各execution processは一つのRunに所属し、同じhost runtimeでactiveなRunを重複させません。完了したRunの後に次のRunを開始することはできます。

通常の `.use()` は各attemptを囲むHono型のmiddlewareとして維持します。group単位の共有資源はscope引数を `.use()` に増やさず、`group(middleware, [children])` で子のまとまり全体を一度囲む形にします。これにより共有コンテキストの型と実行順をtree構造から読めるようにします。group middlewareは共有資源を用意するコストを抑えるためのものであり、case間の順序依存を許す仕組みではありません。

順序を持つ一連の操作は通常case間の依存として扱わず、flowというordered scenarioへ分離する方針を維持します。flow自体のAPIは今回確定しません。

## 関係と複数呼び出しのユーザー契約案

[複数呼び出しのガイド](../guides/multiple-calls.md)は、READMEから続けて読む利用者向けの文書です。
relationと`.it().calls()`を公開APIとして実装し、型検査・実行対象のコード例をガイドへ結び付けています。

### 採用する方向

- unitはデータとサービスを分離し、targetで対象を明示して、契約に沿った検証を書ける形にする。
- 複数関数間の関係は`target('名前', relation({ encode, decode }))`で宣言する。同じ関数を二種類の引数で呼ぶ場合は、対象を増やさない。
- 関係と複数入力の検証は、unit側の`.it()`で対象に限定した呼び出し記述を作る方向を採用する。relationをflow専用とする案は見直す。
- step名・saveAs・任意関数を渡すcallを要求せず、型付きの呼び出し記述をローカル変数や名前付きレコードで組み合わせる。

### ガイドへ具体化した提案

以下の利用契約を実装し、公開型と実行器で検証します。

- `.calls()`のコールバックへtargetに限定した引数ビルダーを渡す。relationなら`c.encode.args()`等、一つの関数なら`c.args()`で呼び出し記述を作る。
- 一つの呼び出し記述、または名前付きの呼び出し記述のレコードを返す。必要な呼び出しを実行した結果へ、既存の`e.result`マッチャを使う。
- 呼び出し記述は正常な戻り値の型付き参照にもなる。参照を実際の値と偽らず、依存先の結果が得られてから次の引数へ渡す。
- 返した呼び出しと、その引数が参照する呼び出しを実行対象とする。同じ記述は一試行に一度だけ実行し、別の記述を引数の一致から統合しない。
- 複数呼び出しも一つのケース・一試行とし、middleware・timeout・retryの既存の境界を維持する。値の依存がない呼び出し間の実行順は保証しない。
- コールバックの内部を解析して依存を推測せず、返された呼び出し記述と型付き参照から構造を得る。blueprintをJSON往復で復元する保証は設けない。

### 実装で確定した境界と今後の検討

- `.calls()`、`CallRef<T>`、`CallsResult<O>`を公開する。blueprintは対象と呼び出し依存を保持し、診断には失敗した呼び出しと未実行の後続を残す。
- オーバーロードは従来同様Parameters / ReturnTypeに従う。単一メソッドのcallsはthisを保持する。middlewareからの引数、結果の加工・プロパティ参照は今後検討する。
- mock / expectCallsは試行全体に合成する。最初のthrow / rejectで後続を停止しexpectを評価しない。複数呼び出しの例外の期待は今後検討する。
- 返された関数を呼ぶ高階関数の契約は、複数関数間の関係とは別に検討する。

コード例はdocs/examples/multiple-calls.test.tsへ移し、引数や結果参照の型はdocs/spec/multiple-calls-types.tsで検証する。

## flowのユーザー契約案

[flowのページ](../guides/flow.md)では、シナリオ全体の検証という利用目的と、現在の検討範囲を説明する。

- `.flow(name, body)`を`.it()`と並べる方向と、targetを必須にしない方向は維持する。
- 一連の操作で成立するシナリオを、他のケースから独立した一つの試行として扱うことを目的の候補とする。
- `.call().args().saveAs()`で全操作と途中結果を管理する旧案は、unitの分離をflowへ適用する根拠が曖昧なため見直す。
- 内部の手順を通常のTypeScriptで書く案を検討する。step名の必須化、step自体の必要性、操作列の事前構造化は、その利用価値から判断する。
- middleware・timeout・retry・観測・後始末の詳細契約と、bodyの型・アサーションの記法は未確定とする。

## ゼロ設定の探索

configもファイル指定もないときは `**/*.{test,spec}.ts` を使います。ゼロ設定の `hanamaru` で `.test.ts` と `.spec.ts` を収集できることを公開契約にします。

## projectの機能と利用例

CLIが読むファイルの集合を名前付きで選ぶ単位の名称はprojectとします。
提供する機能は、ファイルパスやパターンで読むファイルの集合を定め、名前で選べることです。実行するルートは各ファイルの `registerTest` で指定します。
projectはCLIのファイル選択設定です。project設定で `run()` を呼ぶ形にはせず、CLIが登録の収集・実行と結果表示を管理します。ライブラリAPIの `run` は完成した定義を受け取り、configの読込やprojectの選択は行いません。
projectでファイルを選ぶ機能と、groupで環境・子を合成する機能を分けます。選択しないファイルは収集せず、環境の取得は実行する枝のmiddleware内に置きます。
複数projectを選んだらファイルをマージし、同じファイルの登録は一度だけ実行します。`--project` と明示ファイルを同時に指定したら引数エラーにします。

公開契約は[projectで読むファイルを選ぶ](../guides/projects.md)に集約し、unitとintegration/e2eを分ける構成は[利用例](../guides/project-use-cases.md)として別ページに置きます。
unitはソースの隣に置く、e2eはgroupに合成する、といった配置・構成の例をツールのルールにしません。テスト種別と収集方法も対応付けません。
入門・CLI・groupから、機能の契約と利用例を区別して案内します。
projectの利用条件と保証は[project](../guides/projects.md)に記載します。

CLIのexport収集は登録ベースの収集に置き換えました。`registerTest` に親のctx供給を要求しない完成定義を渡し、CLIは選んだファイルに書かれた登録だけを収集します。exportした定義を実行対象とする旧方式は残しません。
ctx要求の検査は利用者の型検査で行い、CLI収集時にはTypeScriptを型検査しません。登録のない選択ファイルはfilterなどによる除外前にproject・ファイルを示してコード2にします。未登録の完成定義は子やチェーン途中の値と区別して警告します。
公開契約は[テストの登録](../guides/registration.md)と[project](../guides/projects.md)を参照してください。

## 依存の要求と失敗集約

依存の要求は `new Test<Ctx>()` に一本化し、値の供給元を要求側の型に含めません。同じ子やmiddlewareを、use・groupのどちらから値を供給する構成でも使えます。
入力が必要になる時点はmiddlewareの配置から自動で追跡します。group前処理が、後から動く親のattemptで初めて生成される値に依存する場合は、合成箇所で型エラーにします。
定義・blueprintの型注釈や入れ子で要求を消しません。入力の使用時点が不明な型へ広げた場合は、group開始時から必要な可能性も含めて検査します。

runの失敗条件には、階層内のgroup middlewareの失敗も含めます。前処理の通常例外で子の試行が一つも始まらなくても、runはfailed / completed、CLIはコード1です。
復元・後処理が完了した通常の前処理失敗はgroup外の後続を続行し、timeout・後処理失敗は後続を中断します。状態の対応は[終了状態の表](../reference/results.md#終了状態の表)で定めます。
