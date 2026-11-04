# 設計判断

README・利用ガイド・API仕様をあるべきUX/DXの契約として記述します。実装都合による留保や旧APIの説明を混ぜません。検証する責任はtargetが定め、テストが追加・縮小しません。

## 採用した契約

- targetで対象の形を固定し、pure()/effectful()で特性を宣言する。省略時pureで明示pureと同じ。明示は一度だけで、ケース追加後の変更を拒否する。
- itとpropertyを並列のケース入口とする。expectはその中の期待であり、propertyと同じ階層の選択ではない。具体例へ入力生成や任意述語を持ち込まない。
- 状態のみ・actionのみでも完成したケースにできる。全責任の網羅や追加の業務契約スキーマを要求しない。
- environmentが評価固有のState/Actionを発行し、evidenceを明示する。依存・fake・入力制御は環境に置き、mock/replace/expectCallsの別レイヤーを設けない。
- 全検証ビルダーを環境準備後・target前に構築し、必要な観測を開始してからtargetを実行する。
- [具体的な構文と禁止例](../guides/writing-tests.md)、[型](../reference/type-inference.md)、[blueprint](../reference/metadata.md)、[実行](semantics.md)を一つの契約として扱う。

## 関係と複数呼び出しのユーザー契約案

複数実行を必要とする冪等性や往復関係も性質であり、propertyのstepsで指定する。単一関数のitにcallsを提供しない。propertyの生成・縮小・再現を実行器が管理し、effectfulなら各候補で環境を初期化する。

## flowのユーザー契約案

scenarioで対象操作を固定し、it/propertyのstepsへ操作列を書く。全操作を宣言順にawaitし、戻り値を使わない操作も実行する。状態を引き継ぐ通常ケース同士の依存を許可しない。操作ごとの例外は未実行の後続と区別し、前段の例外で最後の期待を満たすことはできない。finalで指定した最終操作だけはerror/outcomeでその失敗契約を検証できる。

## caseの独立性と実行境界

共有資源の寿命とケースの独立性を分ける。group middlewareとresourceは環境の共有に使い、トークンは子のenvironmentで各評価に発行する。観測の待機・読み取り再試行とtargetの再実行を分ける。

## 依存の要求と失敗集約

必要な値だけをnew Test<R>()で要求し、供給される時点まで型で確認する。観測失敗や後始末失敗をtargetの契約上の失敗へ置き換えず、原因を集約する。復元不能の状態を次のケースへ持ち越さない。

## コンセプト適合の具体化

- クラス/メソッドで責任を固定し、fromで評価ごとのinstanceを供給する。
- stateのreadは入力・結果を引数にでき、afterで操作後の観測時点を指定できる。観測をtargetへ追加しない。
- actionは出来事を観測する形であり、実効果の証明ではない。受信側の観測と送信口の呼び出しをevidenceで区別する。
- 関係はpropertyのstepsへ統一し、scenarioはpure/effectfulとも具体値のitを提供するが、itに任意述語は提供しない。閉じたlaw集合やrelationを必要としない。
- 構造等価とコピー型を分け、TypedArray/Map/Set/クラス等の具体値を比較できる。privateな値には任意の値アダプターを使える。
- 数値の許容誤差や入力時計の制御を、弱い性質への退避をせず記述できる。
