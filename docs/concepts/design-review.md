# 設計判断

README・利用ガイド・API仕様をあるべきUX/DXの契約として記述します。実装都合による留保や旧APIの説明を混ぜません。検証する責任はtargetが定め、テストが追加・縮小しません。

## 採用した契約

- 純粋なtarget、effect、relation、scenarioを対象宣言で区別する。
- expect / property / relateを型の違う入口とし、具体値の期待を任意述語へすり替えない。
- 状態のみ・actionのみでも完成したケースにできる。全責任の網羅や追加の業務契約スキーマを要求しない。
- environmentだけが試行固有のState・Action・Boundaryを発行する。ケースのreplaceは許可済みの境界だけに使える。
- 全検証ビルダーを環境準備後・target前に構築し、必要な観測を開始してからtargetを実行する。
- [具体的な構文と禁止例](../guides/writing-tests.md)、[型](../reference/type-inference.md)、[blueprint](../reference/metadata.md)、[実行](semantics.md)を一つの契約として扱う。

## 関係と複数呼び出しのユーザー契約案

pure単一・relationはcallsで対象限定の依存グラフを作る。結果に結び付いた呼び出しだけを実行し、宣言順の副作用を期待させない。結果参照の比較はrelateで書き、保存用IDや手書きの型を要求しない。

## flowのユーザー契約案

scenarioで対象操作を固定し、flowのstepsへ操作列を書く。全操作を宣言順にawaitし、戻り値を使わない操作も実行する。状態を引き継ぐ通常ケース同士の依存を許可しない。操作ごとの例外は未実行の後続と区別し、期待した例外で操作列全体を成功にはしない。

## caseの独立性と実行境界

共有資源の寿命とケースの独立性を分ける。group middlewareとresourceは環境の共有に使い、試行トークンは子のenvironmentで発行する。観測の待機・読み取り再試行とtargetの再実行を分ける。

## 依存の要求と失敗集約

必要な値だけをnew Test<R>()で要求し、供給される時点まで型で確認する。観測失敗や後始末失敗をtargetの契約上の失敗へ置き換えず、原因を集約する。復元不能の状態を次のケースへ持ち越さない。
