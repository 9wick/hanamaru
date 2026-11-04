# プラグイン向けblueprint

blueprintは対象の形・特性・ケース種類を独立に保持します。取得しても環境・target・観測・生成器を実行しません。

## blueprintの構造

| 構造 | 保持するもの |
|---|---|
| Target | single / method / scenario。関数、固定receiver、またはクラスとmethodキー |
| Receiver | class形式のfrom resolver。scenarioではmethodキーごとのinstance供給 |
| Characteristic | pure / effectful。省略pureと明示pureの実行意味は同じ |
| Case | example / property / todoと、名前・位置・設定 |
| Input | args / args-from / generated / stepsと、その形に必要な値 |
| CheckBuilder | expect。環境とrefから非空の条件を作る処理 |
| Environment | 各評価の依存と観測器を用意する処理。証拠種別の宣言を含む |

法則専用の別計画や任意関数のcallsグラフはありません。propertyの複数実行もstepsです。scenarioのexampleでも任意述語の条件を含む構造を受付で拒否します。

## グループの階層

groupは完成した子、共有資源を囲むmiddleware、実行設定を保持します。子の特性を変更せず、観測トークンを共有しません。各評価のenvironmentが状態と観測を初期化します。

## compile前後の入力

定義時にはfrom・argsFrom・steps・expectのビルダーを保持します。prepare後にReceiverを解決し、propertyならsampleを使ってCompiledInputの引数や操作列を作ります。stepsの操作列をblueprint取得時に読めるとは保証しません。

各操作はtarget内のキー・引数・先行結果refを持ちます。宣言順・返された結果の形・操作完了refを保持し、voidの戻り値でもafterのチェックポイントとして使えます。対象外・別評価のref、前方参照・循環は拒否します。

## 明示的な最終操作の構造

各操作はmode: return-required / finalを持ちます。finalは最後に一つだけで、そのrefが返却の単独値またはレコードの一フィールドに存在することをcompileで検査します。最終操作のindexをterminationTargetとして保持し、error/outcomeの参照先をその操作に限定します。

返却refの木には、どの操作の正常結果を必要とするかを保持します。最終error/outcomeと最終正常値の混在を禁止し、先行成功結果への参照は許します。前段が失敗した場合の最終操作はnot-runで、前段の例外をその結果へ流用しません。明示的な最終操作なしのstepsは全操作return-requiredです。

## 期待と観測の記述

| 条件 | 保持する内容 |
|---|---|
| exact / part / close | 対象ref、比較方式、期待値、キー経路、許容誤差 |
| error | throw値、message、例外型による絞り込み、部分の条件 |
| predicate | refまたは非空refレコード、名前、同期述語 |
| state | トークン、引数の値/ref、before/after-plan/after-step、待機、照合方法 |
| action | トークン、期間、全件一致/個数/不発生 |

predicateに含まれる例外refはthrow/rejectの期待と例外型の制約を保持します。同じ終了対象の正常resultを含むrefとの混在を拒否し、ofTypeの検査に成功してからfield/projectの値を取得します。これは独立したrelation条件ではなくpredicateの入力です。

各観測はevidence（real-effect（対象自身または実資源） / substitute-effect（fakeの契約モデル） / call-record（引数等の記録））と所有する評価を持ちます。BoundaryやexpectCallsの別構造はありません。証拠の強さをstate/actionのkindから推測しません。

状態の引数refには取得可能時点を保持します。結果依存のbefore、未完了の操作結果に依存するafter、他観測の結果を引数にする構造を拒否します。条件はsource: expectと配列内indexで対応させます。

期待する終了はreturn / throw / return-or-throwとしてcompileで確定します。propertyのoutcome refはunionの枝と、withErrorの型・射影を保持します。withErrorはthrow枝でだけ適用し、同じ終了対象の正常result/error専用refとの混在は拒否します。先行操作の成功結果は併用できます。outcomeもpredicateの入力であり、別の条件kindではありません。

## 実行結果の値と参照

比較用のValueImageと、述語へ渡す型付きデータ、生のIdentityRefを区別します。期待値はcompile、sampleは候補選択、inputは呼出し前、resultは操作完了、観測は指定時点で保持します。後から変更された値へ比較対象を追従させません。

ValueImageは独自クラスを実行可能なコピーとして偽装しません。nativeデータ・prototype・公開データ・参照を比較情報として保持し、opaqueな値は必要なvalueAdapterを記録します。[値の比較](value-comparison.md)に従います。

## 評価時点

| 処理 | 時点 |
|---|---|
| it/property/eachの定義コールバック | 定義時 |
| group middleware/resource | 共有資源の寿命 |
| 生成・縮小候補選択 | propertyの各評価前 |
| middleware/environment | 各評価のprepare |
| from/argsFrom/steps/expect | prepare後のcompile |
| beforeのstate/action.open | target前 |
| 対象の各操作 | 宣言順にawait |
| after-stepのstate | 指定操作完了後・次の操作前 |
| after-planのstate/action.finish | 計画のsettleと指定待機の後 |
| 条件の照合 | 必要な保存値を取得後 |
| action.dispose/環境の後処理 | 成否に関係なく各評価の最後 |

## 参照を保持する意味

blueprintは関数・資源参照を持ち、JSON往復による復元を保証しません。再現用のsampleと診断値は独立して保存します。pure宣言や証拠種別の真偽を、任意関数の内部から自動証明することはありません。
