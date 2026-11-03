# 実行セマンティクス

定義から得た対象・入力・観測・期待を、独立した試行として実行します。利用者向けの書き方は[公開APIの記述契約](../guides/writing-tests.md)に従います。

## 定義と実行の境界

Testのチェーンは定義を作り、targetを実行しません。it / each / flowのコールバックは定義時に呼びます。callsも定義時に対象限定の依存グラフを作ります。argsFrom・steps・検証ビルダー・境界resolverは保持し、試行の環境準備後に評価します。

registerTestは親からの供給が不要な完成定義を登録します。blueprintの取得は環境も観測も開始しません。定義コールバックのthrow、空のeach・子・条件、静的に不正な設定は定義エラーです。

## テストの受付

全定義の対象kind、入力kind、完成条件、参照、設定値を検査します。pureへenvironmentを付ける、scenarioへcallsを渡す、生成入力にproperty/relateがない、target自身の境界を代替する、対象外・別ケースのrefを使う等は拒否します。実資源の参照が必要な検査は試行のcompile段階で行います。

受付エラーではtargetを開始しません。CLIは収集・受付の失敗をコード2、開始した試行の失敗をコード1として区別します。試行のcompileで検出する動的な不正もコード1で段階と原因を示します。

各ケースは他のケースの実行順・実行有無へ依存しません。名前の重複ではなく構造と宣言位置で対応させます。同じ定義を別経路へ合成したものは、それぞれ独立した実行箇所です。

## Runとprocess

Runが所有する開始済み処理と後始末が終わってからRunを完了します。同じhost runtimeでactiveなRunは一つとし、完了後に次を開始できます。実行戦略としてのprocess数や配置をケースの意味にしません。

## group middleware

`group(middleware, [children])` は子全体を一度囲みます。attemptのuseは各試行に適用します。groupの前処理は親groupの安定したctxを受け、後から開始するattemptのctxに依存できません。

共有資源はgroup middlewareで用意できますが、environmentをgroupへ渡すことはできません。観測器・境界トークンは子のenvironmentが試行ごとに作ります。共有資源内のデータの初期化・ケースごとの範囲分離は環境が提供します。

groupの前処理失敗では子を開始せず、groupの失敗と子の未実行理由を残します。通常の前処理例外で解放が完了すればgroup外は続行できます。timeout・後処理失敗は後続を中断します。

## 実行設定の解決

timeoutとretryは外側から内側へ、明示された値だけを上書きします。既定は試行5,000ms・retry 0回です。ケースでは入力/操作の確定前に指定します。観測の期限・間隔は条件ごとに指定し、ケース全体のtimeout/retryと混同しません。

## 一試行の手順

1. **prepare**：attempt middlewareとenvironmentを順に開始する。新しいctxと試行所有者を作り、環境のscopeがトークンを発行する。
2. **compile**：argsFromまたはstepsを構築し、境界resolverとexpect/property/relate/expectCallsを一度評価する。対象の引数・観測条件・期待する終了を確定する。toEqual・part・action全件一致・境界の引数条件の期待値は、スナップショット領域を検査して独立したコピーとして保存する。保存失敗ならtargetを開始しない。toBeと参照同一性のLiveRefはコピーしない。期待のValueRefは実測値ではない。条件・トークンの所有者・action区間の矛盾を検査する。参照同一性の条件へSnapshotRefを渡していた場合も拒否する。
3. **before**：before参照またはunchangedのstateを読み、コピーする。使用するactionを宣言順にopenする。openが完了するまでtargetを開始しない。
4. **instrumentation**：許可済み境界の代替と呼び出し記録を設定する。適用途中の失敗では適用済みのものを復元する。
5. **target**：一回の関数、callsの依存グラフ、またはstepsの順序列を実行する。Promise/thenableをawaitし、正常結果・throw/rejectを区別して保持する。
6. **observe**：targetのsettle時刻を基準に、後状態の取得とactionの期間待機を開始する。同じstateの即時後値は一度読み共有する。eventuallyはその条件のreadだけを再試行する。必要なaction.finishを区間終了ごとに一度呼び、値をコピーする。actionの環境側記録は発生時点の値であり、finish時点に可変データを読み直す実装は契約違反である。
7. **assert**：期待する終了を照合し、取得できた値の条件をすべて評価する。失敗後も独立した条件は評価する。観測待機は条件を満たすためにtargetを再実行しない。
8. **cleanup**：開いたactionを逆順にdisposeし、境界を逆順に復元してから、environment/middlewareの後処理を内側から外側へawaitする。失敗を消さず、解放不能なら後続を中断する。

prepareからcleanupまでが試行期限に含まれます。途中で条件が不一致でもcleanupを省略しません。stateの読み取りはreadonlyの観測責務とし、[値領域](../guides/writing-tests.md#スナップショットの値領域)の検査後にコピーします。structuredCloneの成功だけを受入条件にはしません。コピー不能・取得不能を空値へ変換しません。actionの期間はtarget開始前のopen完了から、settleまたはsettle後の指定時間までです。

複数actionのopenは宣言順、期間終了のタイマーは同じsettle時刻を基準にします。長い期間のactionを待つことで短い期間が伸びないよう、それぞれのfinishを独立に開始します。出力の条件順は宣言順を保ちます。

## 結果refの取得と保存

compileで各条件が要求する値と参照同一性の用途を判別します。valueはcompile時、inputは呼び出し直前、各resultはその呼び出しの正常完了直後に、必要な値・部分をスナップショット領域へ検査して保存します。結果のfield/partもその時点で解決します。生の参照を必要とする条件では同時に参照を保持し、値の保存と混同しません。

calls/stepsでは、各結果の保存を後続操作より前に行います。結果refを次の引数へ解決するときは生の値を渡し、期待・性質・値の関係を照合するときは保存値を使います。結果レコードも各結果の保存値から組み立てます。LiveRefであることを理由に、値比較を照合時点の可変値へ遅らせません。

保存に失敗したら観測障害として試行を失敗にし、後続のcalls/stepsを停止します。target自身のthrowとは区別し、取得可能な状態/actionの後観測と解放は継続します。検証に使わない中間値をコピーすることはありません。

## 待機と観測値

eventuallyはtargetのsettle直後に一度read・比較します。不一致ならintervalMs後に再取得し、withinMsの期限で最後の未完了取得も打ち切って失敗を記録します。開始済みの処理が停止しない場合は後始末未完了として扱い、結果を後から成功へ変更しません。期限内の最初の一致で完了し、その後の不変は保証しません。

actionは正の一致が早く成立しても指定区間を短縮しません。不発生も区間終了とfinish成功後にだけ判定します。finishの失敗はactionの全条件の観測障害となり、noneを成功にしません。

observeの一つの失敗で他の独立した観測を省略しません。ただし試行timeout・外部中断・接続の解放不能など、実行境界の安全な終了ができない場合は残りを未評価としcleanupへ進みます。

## 正常終了・例外の期待

error条件がなければ正常終了を期待します。errorと状態/action/境界条件は併用できます。errorとresult/property/relateは併用できません。calls・scenarioは正常完了だけを期待し、途中のthrow/rejectは常に失敗です。

| 実際の終了 | 結果・例外の照合 | 状態・actionの観測 |
|---|---|---|
| 正常終了 | resultを評価。error期待なら不一致 | 指定した観測と待機を実行 |
| throw/reject | error条件と照合。正常期待なら不一致 | settle後の観測・待機を継続 |
| calls/stepsの途中のthrow | 原因と未実行操作を記録。存在しない結果は未評価 | 操作列全体のsettleとして、取得可能な観測を継続 |
| timeout・外部中断 | error条件で成功にできない | 未完了の区間・値は未評価。取得済み情報を残し後始末 |

return undefinedとthrow undefinedは別です。targetを開始していない場合は、空の記録から不発生・notCalledを成功にしません。

## 途中の失敗

| 段階 | 処理 |
|---|---|
| prepare | 未開始の下流は動かさず、取得済み資源を後始末 |
| compile | target・観測を開始せず、準備した環境を解放 |
| before | targetを開始せず、開いたactionをdispose。すべての期待は未評価 |
| instrumentation | targetを開始せず、適用済み代替と観測を解放 |
| target | 失敗の値を保持し、上記の終了別の規則で観測・照合 |
| observe | 該当条件の観測障害。他の独立した観測を継続 |
| assert | 不一致・述語例外を記録し、他の条件を継続 |
| cleanup | 先行する失敗も保持し、残りの解放を試みて後続を中断 |

prepare/compile/before/instrumentation/observe/assertの失敗をtargetの期待した例外にはしません。action.openが途中で失敗してsessionを返せない場合は、openの実装が部分的に取得した資源を解放する責務を持ちます。

## middlewareとnext

middleware / environmentはnextを一度呼び、その完了値を返します。後処理は `try { return await next(fields) } finally { ... }` で待機します。next未呼出し・複数呼出し・返却前の終了は実行時にも失敗にします。外側がcatchしても記録した失敗は消えません。

コンテキストのフィールドはreadonlyで、値の供給は浅い合成です。state/actionのスナップショットのコピーとは別です。環境のscopeによる発行はnextを呼ぶまでに限り、後処理や終了後には発行できません。

## 呼び出し記録とモック

replaceとexpectCallsは同じ試行のBoundaryトークンだけを受け取ります。記録区間はtargetの開始からsettleまでです。prepare・argsFrom・検証・観測器の関数からの呼び出しは記録に含めません。バックグラウンド配送を含む実効果の区間にはactionを使います。

引数は呼び出し開始時に同じスナップショット領域を検査して診断・比較用の値としてコピーし、後の変更を混入させません。コピー不能はinstrumentationの実行失敗とします。thisと本物の戻り値・Promiseを保ち、対象へ返す値そのものをコピーしません。同期throwした呼び出しも記録します。

応答列のonceは開始順に消費し、試行ごとにリセットします。通常動作を必須にし、任意のcallsFakeは提供しません。呼び出し確認と効果の観測の違いを結果へ残します。

## 適用と復元

境界の代替はケース内で指定し、groupから任意のmockを注入しません。対象関数自身・scenario/relationの構成要素と同じ参照の代替を拒否します。作用範囲は環境が公開したobjectのmethod経由に限り、保存済み参照やmodule内部へ暗黙に差し替えを広げません。

同じobject/keyに複数の境界トークンを発行することはその試行で拒否します。同じトークンへのreplaceもケース内で一度だけです。書き換え不能・アクセサ・非関数はinstrumentationで拒否し、適用済みのものは元のdescriptorへ復元します。

## ケース間の状態

トークン・応答列・観測記録は試行ごとに新規作成します。外部DBや共有資源の範囲分離は環境が行い、全外部状態の自動復元は約束しません。順序を持つ操作は一つのscenarioに置きます。

## 生成入力と再試行

forAllはseedからruns件の引数を宣言順に生成します。各サンプルを独立した環境・検証の実行として扱い、最初の失敗で残りを未実行にします。ケースの一試行期限はサンプル全体に適用し、各サンプルのmiddlewareも囲み直します。生成器はpureな単一関数にのみ使用します。

ケース全体のretryでは同じseedと入力列を用い、環境を最初から作り直します。失敗したサンプル番号と入力を保持します。観測の再試行とは別で、失敗の履歴を上書きしません。

## skip / todo / only

定義は収集しますが、skip/todoの環境・観測・targetは開始しません。onlyは選択であり検証条件を変更しません。未実行を成功した検証として報告しません。

## 診断

条件はsource（expect / property / relate / expectCalls）と配列内のindexで対応させます。観測段階・区間・対象・期待・実測・原因を保持します。まだcompileできなかった条件は捏造せず、ビルダーの位置と失敗段階を示します。
