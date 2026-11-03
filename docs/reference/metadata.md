# プラグイン向けblueprint

blueprintは対象・特性・ケース種類を独立に保持します。取得しても環境・target・観測・生成器を実行しません。利用者がIDや内部構造を書き直す必要はありません。

## blueprintの構造

| 構造 | 内容 |
|---|---|
| Definition / Group | 共通設定、group middleware、非空の子と宣言位置 |
| Suite.target | shape: single / relation / scenario、対象の関数参照または名前付き集合 |
| Suite.characteristic | pure / effectful。省略時pureと明示pureは同じ実行値 |
| Suite.cases | kind: example / property / todoの判別可能なunion |
| ExampleCase | 具体的な引数またはsteps、expect/expectCalls、境界代替、設定 |
| PropertyCase | 生成記述、seed/runs/maxShrinks、検査計画、境界代替、設定 |
| PropertyPlan | kind: single / scenario / lawと、そのkind固有の必須値 |
| TodoCase | 名前・位置・未実行の指定。入力や検証なし |

ビルダーの明示特性宣言済みフラグは、pure/effectfulを二度呼ぶことを防ぐ型の状態です。完成blueprintの実行意味には省略と明示の差を持たせません。sourceへ明示の有無を保持する場合も実行権限を変えません。

ExampleCaseの入力はargs / args-from / stepsのunionです。singleのPropertyPlanは直接の生成引数またはargsFrom、scenarioはstepsビルダー、lawはブランド付き法則と対象キーを保持します。lawと独自のexpect/expectCallsは混在しません。

## グループの階層

groupは資源・共通設定のスコープです。完成した子を合成し、そのtargetの特性やケース種類を変更しません。environmentはeffectfulな子のuseで各評価に適用し、groupに直接登録できません。

## 操作と法則の記述

stepsは定義時にはビルダー関数です。環境準備後、propertyならsampleも揃ったcompileで初めて順序付き操作列へ変換します。全操作を実行し、未使用の戻り値を理由に省略しません。

法則は定義時にkindと型に対応する対象参照を保持します。idempotentは同じ関数を二回、roundTripは指定した二関数を順に実行する計画になります。自由なcallsグラフや任意の関数を実行するコールバックはblueprintに受け付けません。

## compile前後の入力

定義にはresolverとビルダーを保持し、CompiledInputにはその評価の引数・操作列・法則計画を保持します。propertyの生成sampleは対象に渡す前に独立した値として保存し、argsFromやtargetの変更から再現情報を守ります。

sample・args・各操作のrefを、それぞれケース・試行・評価番号へ結び付けます。別候補や別試行の参照を持ち込むことを拒否します。blueprintから環境依存の操作列を事前に取得できるとは約束しません。

## 期待と観測の記述

expect/expectCallsは各評価のprepare後・target前に一度構築します。itとpropertyは異なる型のexpectビルダーを持ち、条件にもcaseKindを保持します。propertyだけが性質・ref間の関係を作れます。

| 条件kind | 必須情報 |
|---|---|
| exact / part | 対象ref、値か参照かの比較方法、キー経路、期待値 |
| error | throw値・例外の種別・messageの条件 |
| predicate / range | 対象refまたは非空のrefレコード、名前、同期述語または範囲 |
| relation | 二つのrefと比較方法。参照同一性はlive同士だけ |
| state-unchanged | Stateトークンと前後の取得 |
| action | Actionトークン、区間、全件一致/個数/不発生 |
| boundary-call | Boundaryトークン、引数・回数・開始順 |
| law | 法則kind、対象、sample、比較する実行結果 |

exact/part/action全件一致と境界引数の期待値はcompileで値領域を検査してコピーします。toBeと参照同一性だけは生の参照を保持します。条件のsourceはexpect / expectCalls / lawと配列内indexです。lawは法則が定めた比較順のindexを使います。

## 実行結果の値と参照

valueはcompile、sampleは候補選択直後、inputは呼び出し直前、resultは各呼び出し完了直後に必要な値・部分を保存します。propertyの入力や中間結果を後続の変更へ追従させません。次の操作へ渡す生の戻り値と、検証用の保存値は別に保持します。

LiveRefはinput/result/value、SnapshotRefはsample/state/before/actionです。合成結果レコードのrootはSnapshotRef、fieldで選ぶ個々の結果は元の出自を保ちます。期待・実測は[値領域](../guides/writing-tests.md#スナップショットの値領域)に従います。

## 評価時点

| 処理 | 評価時点 |
|---|---|
| it / property / eachの定義コールバック | 定義時。設定とビルダーを保持 |
| group middleware / resource | 要求された共有資源の寿命に従う |
| 候補生成・縮小候補選択 | propertyの試行内。環境を始める前 |
| attempt middleware / environment | itは試行ごと、propertyは生成例・縮小候補ごと |
| argsFrom / steps / 境界resolver / expect | 各評価のprepare後・target前 |
| 状態の前値取得 / action.open | compile検査後・target前 |
| target / 法則 / scenario | 観測準備後。複数実行は順次await |
| 状態の後値取得 / action.finish | target計画全体のsettle後、条件の待機に従う |
| 条件の照合 | 必要な値・観測を取得後 |
| action.dispose / 復元 / 環境の後処理 | 各評価の終わり。次の候補の前 |

## 参照を保持する意味

定義には関数・実資源への参照を持てるため、JSON往復による復元は保証しません。結果の診断とpropertyの再現データは独立して保存します。任意関数を解析して純粋性や責任を推測しません。
