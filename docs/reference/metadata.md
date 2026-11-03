# プラグイン向けblueprint

blueprintは利用者が書いた対象・入力・観測・検証を構造として保持します。取得しても環境・target・観測器・述語を実行しません。登録・実行とは別の操作です。

## blueprintの構造

| 構造 | 内容 |
|---|---|
| Definition | 共通設定とgroupの列 |
| Group | 表示名、宣言位置、group middleware、非空の子 |
| Suite | target、attempt middleware/environment、実行設定、非空のケース |
| Target | kind: pure / effect / relation / scenarioと対象参照。relation/scenarioは非空の名前付き関数群 |
| Case | 名前・位置・実行指定、入力/操作、検証ビルダー、境界代替、実行設定 |
| Input | kind: args / args-from / calls / generated / stepsのいずれか。種類ごとの必須値を持つ |
| Checks | expect / property / relate / expectCallsの登録済みビルダー。各入口は一度だけ |
| Replacement | environmentのBoundaryを選ぶresolverと、型に対応する応答列・通常動作 |

Inputは省略可能フィールドの集合ではなく判別可能なunionです。argsは引数、args-fromはビルダー、callsは構築済み依存グラフ、generatedは生成記述とseed/runs、stepsはctxを受け取るビルダー関数を保持します。定義時のInput.stepsには、まだ操作列はありません。未完了の定義はblueprintの実行対象になりません。todoは入力・検証を持たない別のvariantです。

Checksは結果/例外だけを意味しません。状態のみ・actionのみでも完成できます。入力と最低一つの完成条件を必要とし、生成入力ではpropertyまたはrelateを要求します。種類ごとの制約は[型推論](type-inference.md#完成条件)に従います。

## グループの階層

groupは高価な資源と共通設定のスコープです。親から子へ値の供給と設定を解決し、子の定義を書き換えません。環境の共有はケース間の意味的な順序依存を許可しません。名前は表示用で、位置と構造でケースを対応させます。

## 呼び出しの記述

callsは対象のキー、引数、先行結果へのrefを保持します。返された結果へ到達する呼び出しだけが実行対象です。stepsのビルダーはprepare後のcompileで評価し、CompiledInput.stepsに全操作を順序付きで保持します。未使用の戻り値を理由に操作を除外しません。

呼び出し/操作のrefはケースに属します。引数や返却に異なるケースのrefを使うこと、循環・前方参照・対象外の関数を含むことを受付で拒否します。関数内部を解析して依存や副作用を推測しません。

## compile前後の入力

Inputは定義時のデータです。CompiledInputは試行ごとの解決済みデータで、args-fromは実引数、stepsは操作列へ変換します。callsは定義済みの依存グラフを試行へ結び付け、generatedは当該サンプルの引数とseed・番号へ変換します。プラグインがblueprintからstepsの全操作を取得できるとは保証せず、実行結果でcompileした操作列と結果を対応させます。

## 期待と観測の記述

ビルダーは各試行の準備後・target前に一度評価し、CompiledChecksへ変換します。コンテキストの実資源と、まだ実行していない結果のValueRefを区別します。実測値を得るためにビルダーを実行後へ延期することはありません。exact/part/action全件一致とboundary-callの期待値はcompileで値領域を検査し、独立したコピーとしてCompiledChecksへ保存します。元の入力やctxがtargetに変更されても期待値は変わりません。toBeと参照同一性のLiveRefだけは参照を保持します。

| 条件のkind | 必須の情報 |
|---|---|
| exact | 対象ref、比較方式、期待値 |
| part | 対象ref、非空のキー経路、比較方式、期待値 |
| error | 種別・message・throw値の条件 |
| property | 対象ref、名前、標準条件または同期述語 |
| relation | 比較方式と型が対応する二つのref。refはlive/snapshotの出自を保持し、同一性比較はliveのみ |
| state-unchanged | Stateトークン |
| action | Actionトークン、区間、全件一致/個数/不発生の条件 |
| boundary-call | Boundaryトークン、引数・回数・開始順の条件 |

状態のexact/part条件には、取得時点（after）と、即時かeventuallyの待機設定を保持します。before参照やunchangedがあれば、実行前の取得も必要です。property/relateのaction参照も区間を持ちます。

CompiledChecksのsourceはexpect / property / relate / expectCallsと、その返却配列内のindexです。実行前に判明した全条件は、失敗時にも未評価理由を含めて結果へ対応させます。

## 実行結果の値と参照

CompiledChecksは各refについて、値の検証に必要な部分とidentity比較に必要な参照を保持します。valueはcompile、inputは呼出し直前、resultは各呼出し完了直後に解決します。実行記録には生の値の参照と、検証用の保存値を別々に持ちます。stepsの先行結果の保存値を後続操作で上書きしません。

## 評価時点

| 処理 | 評価時点 |
|---|---|
| it / each / flowの定義コールバック | 定義時。入力とビルダーを保持する |
| callsの定義コールバック | 定義時。ctxを提供せず依存グラフを作る |
| group middleware | 子全体を一度囲む |
| attempt middleware / environment | 各試行。environmentだけが試行トークンを発行 |
| argsFrom / steps / 境界resolver / 各検証ビルダー | 準備後・target前。生成入力では各サンプルの準備後 |
| 状態の前値取得 / action.open | ビルダーの妥当性検査後・target前 |
| target / scenarioの各操作 | 観測準備後。操作列は順次await |
| 状態の後値取得 / action.finish | targetのsettle後、条件が定める待機に従う |
| 性質の述語・関係・一致の照合 | 必要な観測値を取得後 |
| action.dispose / 代替の復元 / environmentの後処理 | 照合の成否に関係なく終了時 |

stepsはctxを使いますが、実行するのは操作ではなく操作記述の構築だけです。scopeトークンはその試行でしか使用できません。妥当性確認前に差し替えやtarget実行を開始しません。

## 参照を保持する意味

関数と実資源の参照を持つため、blueprintのJSON往復による復元は保証しません。診断用には値と実行情報を別に保存します。状態/actionの観測値は[値領域](../guides/writing-tests.md#スナップショットの値領域)を検査してコピーし、前後の可変参照を共有しません。

ビルダーへ架空のctxを渡して観測値を抽出したり、任意関数の内部を読んで契約を生成したりしません。environmentの許可とcaseが使った境界を対応させ、実効果・代替環境の効果・呼び出し記録を区別します。
