# 仕様改訂の判断記録

このページはレビュー後の採否を残す記録です。
ユーザーとの公開契約はREADMEと下記の各ページ、および[型契約](./spec/hanamaru.d.ts)に記載しています。
ビルダー・ランナー・CLIは未実装で、型で検証した範囲と実行時の検証対象を[実装状況](./limitations.md)で区別します。

## 採用した契約

| 項目 | 判断と公開仕様 |
|---|---|
| 宣言位置 | it等とgroupの位置を自動取得する。失敗時は位置を表示し、成功時もデータに保持する。[実行結果](./results.md) |
| identity | 収集したblueprint内のpathで区別し、手書きIDを要求しない。編集をまたぐ同一性やテスト対象の実装位置は保証に含めない。[実行結果](./results.md) |
| 構造化した失敗 | 条件・期待・観測・原因を保持する。JSONでも特殊な値を区別する。[実行結果](./results.md) |
| timeout / retry | group、`.target()` の前後、ケースで指定し、項目ごとに継承・上書きする。全試行を結果へ残す。[実行設定](./execution-options.md) |
| each | each(name, rows, body)をitと並ぶ入口にする。[each](./each.md) |
| mock sequence | onceを順に指定し、最後に通常動作を必須とする。[モック](./api-mock.md) |
| nth | 指定メソッドのn回目の引数を検証する。spy登録を要求しない。[マッチャ](./api-expect.md) |
| middleware | `middleware(fn, { timeout })` で作り、関数のままでは登録できない。ケースへ値を渡す手段は `next(fields)` だけにする。[middleware](./middleware.md) / [用語集](./glossary.md) |
| 前処理期限・後処理期限 | middlewareの定義に持たせ、前処理と後処理へ独立に適用する。既定値は10,000ms。[middleware](./middleware.md) |

軽量なチェーン、値と状態遷移の型安全、テスト定義と実行の分離を保ちます。
通常の実行入口は `run(test)` とし、blueprintはプラグイン作者に公開します。実行計画は実行器の内部で決めます。

## expectの書き心地を維持する

e.fromで期待値ごとにコールバックを追加する案は撤回しました。
`e.ctx`を含む現行の書き方を保ち、expectを遅延処理として公開します。
実行前に全matcher・正常/例外の期待を得ることは初版の保証に含めません。
事前構造化をさらに進める方式は継続検討ですが、未決の案を現在の契約として扱いません。
[プラグイン向けblueprint](./metadata.md)が現在の約束です。

## 今回含めないもの

- 時計の制御は次verで扱います。
- process・run単位の共有資源の管理、呼び出しの順序・部分一致、watch・coverage・parallel・shardingは後続です。
- flowは今回の計画外です。操作記述・値の受け渡し・実行単位を今回確定しません。
- each専用のonly/skip/todo表記は未採用です。通常のonlyとCLIのfilterは展開後のケースに作用します。
- signal、custom matcherの登録API、タグ・注記、snapshotは追加しません。
- module mockは初版に含めず、オブジェクトのメソッド境界を保ちます。

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
表示とrunの集約は、同じ試行の記録から必要な値を計算します。[実行結果](./results.md)に規則を記載しています。

## 中断時の状態とCLIの時間制限

[終了状態の表](./results.md#終了状態の表)で、試行・ケースの派生値・run・後続ケースを定めます。
timeoutとcleanup失敗はfailed、失敗がないまま割り込まれた試行はcancelledです。既存の失敗を消さず、複数の中断原因の優先順位も固定します。
収集期限と終了猶予は[CLIの設定](./cli.md#時間制限)で変更可能にしました。30,000msと1,000msは未指定時の既定値であり、全プロジェクトに強制する時間ではありません。

## caseの独立性と実行境界

caseは他のcaseの実行有無・実行順に依存しない独立した実行単位とします。初版が宣言順に直列実行しても、その順序は利用者が依存する契約にはしません。将来のshuffle・parallel・複数process配置を許せる意味論にします。

実行モデルは Run > Process * N とします。各execution processは一つのRunに所属し、同じhost runtimeでactiveなRunを重複させません。完了したRunの後に次のRunを開始することはできます。

通常の `.use()` は各attemptを囲むHono型のmiddlewareとして維持します。group単位の共有資源はscope引数を `.use()` に増やさず、`group(middleware, [children])` で子のまとまり全体を一度囲む形にします。これにより共有コンテキストの型と実行順をtree構造から読めるようにします。group middlewareは共有資源を用意するコストを抑えるためのものであり、case間の順序依存を許す仕組みではありません。

順序を持つ一連の操作は通常case間の依存として扱わず、flowというordered scenarioへ分離する方針を維持します。flow自体のAPIは今回確定しません。

## ゼロ設定の探索

CLIのinclude未指定時は `**/*.{test,spec}.ts` を使います。ゼロ設定の `hanamaru` で `.test.ts` と `.spec.ts` を収集できることを公開契約にします。

## group開始前の要求と失敗集約

`new Test<R, G>()` で、各attemptが親に要求するRと、group開始前に要求するGを分けます。どちらも既定は `{}` です。
useは各attemptのコンテキストだけを拡張します。group middlewareの追加フィールドは、そのgroupの子に対して両方の要求を満たせます。
group・runは両要求を別々に検査し、定義・blueprintの型注釈や入れ子で要求を消しません。group前処理が親のattemptで初めて生成される値に依存する合成を型で防ぎます。

runの失敗条件には、階層内のgroup middlewareの失敗も含めます。前処理の通常例外で子の試行が一つも始まらなくても、runはfailed / completed、CLIはコード1です。
復元・後処理が完了した通常の前処理失敗はgroup外の後続を続行し、timeout・後処理失敗は後続を中断します。状態の対応は[終了状態の表](./results.md#終了状態の表)で定めます。
