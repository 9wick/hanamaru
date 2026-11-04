# 実行セマンティクス

対象・特性・it/propertyから実行計画を作り、契約に対応する効果を観測します。[公開構文](../guides/writing-tests.md)に従います。

## 定義と実行の境界

定義時にit/property/eachのコールバックを評価し、対象とビルダーを保持します。from・argsFrom・steps・expectは環境準備後に評価します。blueprint取得では対象・観測・環境を実行しません。

pure/effectfulはケース前に一度だけ明示できます。省略時pureは同じ実行意味です。最初のケース後の切替、scenarioのitへの任意述語、itへの入力生成や任意述語を拒否します。

## テストの受付

対象のキー・形・特性、receiverの供給、完成条件、設定値と参照を検査します。静的な不正は開始前に拒否します。実際のinstanceや観測器が必要な検査はcompileで行います。

受付失敗はCLIコード2、開始した試行の失敗はコード1です。ケースは他ケースの実行順に依存しません。

## Runとprocess

Runの開始済み処理と後始末を完了してからRunを終了します。process数や配置をケースの意味に含めず、同じhost runtimeでactiveなRunは一つとします。

## group middleware

group middlewareは子全体を一度囲みます。useのmiddleware/environmentは各評価を囲みます。groupは資源を共有できますが、観測器は評価ごとに作り、次の評価までに初期化・解放を完了します。

## 試行と評価

retry一回分がattemptです。itは一評価、propertyは生成と縮小の複数評価を含みます。一つのsteps内では必要な状態を保ち、候補間では新しい環境で始めます。

## 実行設定の解決

timeout/retryは外側から内側へ明示値だけを上書きし、既定は5,000ms/0回です。propertyの試行期限は生成・全候補の評価・縮小・後始末を含み、候補ごとにはリセットしません。

## 一評価の手順

1. prepare：middleware/environmentを開始し、評価固有の依存・観測器を用意する。
2. compile：fromを解決してreceiverを検査し、argsFrom/steps/expectを構築する。期待値と定数の比較表現を保存し、refの所有者・観測引数の取得時点を検査する。
3. before：実行前の状態を読み、action.openを開始する。全準備が成功してからtargetへ進む。
4. target：一回の対象またはstepsの操作列を実行し、各正常結果の必要な値をその時点で保存する。
5. checkpoint：after(stepRef)の観測を、指定操作の結果保存後・次の操作より前に実行する。
6. observe：計画全体のsettle後、結果依存の状態引数を解決して読み、必要な待機とaction.finishを行う。
7. assert：取得した値を照合し、不一致・述語例外・取得不能・未評価を区別する。
8. cleanup：開始したactionを逆順にdisposeし、environment/middlewareの後処理を内側から外側へ待つ。

s.inputはcompileで利用できる具体値であり、sampleに応じて引数を計算できます。CallRef/FinalStepRefは未実行の記述なので、その値に応じた分岐はできません。

フレームワークは任意メソッドの置換や復元を行いません。環境が用意したfakeや接続先の初期化・解放は、その環境の責務です。後始末不能では後続を中断します。

## receiverと対象の固定

クラス形式のfromは各評価で一度解決します。instanceof指定クラスと、指定キーが呼出し可能なデータプロパティであることを検査します。継承instance、prototypeメソッド、instanceの関数フィールドを許します。固定するのは宣言クラスと公開操作名までです。供給instanceが契約を守る実装であるかは環境提供者の責任であり、メソッド本体を不正にstubへ変えていないことを自動証明しません。getter拒否はreceiver解決段階に任意の処理を起動しないためです。

staticなtarget(obj,key)はその受け手を固定します。scenarioのmethod記述子はfromのinstanceマップから受け手を解決します。結果を見て対象や受け手を切り替えることはできません。

## 観測引数とチェックポイント

stateの定数引数はcompile、input/sample引数は呼出し前、結果引数は該当操作の完了後に型付きデータとして保存します。readにはその保存値を渡し、後続の変更で別のキーを読まないようにします。

state(...).before()/unchangedは実行前に引数が揃う場合だけです。beforeはpropertyで前後関係を表すrefであり、前値だけでは検証を完成できません。afterは指定操作の完了までに全引数が揃うことを必要とします。他の観測に依存する引数は受け付けません。これにより観測をtargetの操作集合へ追加せずに、返されたIDや各操作の結果から読む対象を決められます。

結果が存在しない場合、依存する観測は理由付きの未評価とします。正常結果が必要な条件をerror期待へ混ぜた定義はcompileで拒否します。結果依存のafter-planを未実行のまま成功にはしません。

## 待機と観測値

state.eventuallyはsettle直後からread・照合だけを繰り返します。不一致だけをintervalMs後に再試行し、取得失敗・コピー失敗は即時に観測障害とします。期限内の最初の一致で完了し、以後ずっと不変であるとは報告しません。期限で取得が未終了なら後始末未完了として扱います。

actionはopen完了からtarget計画のsettle、またはsettle後の指定時間まで記録します。早く肯定条件が成立しても区間を短縮せず、それぞれのfinishを指定時刻に開始します。環境は発生時に履歴を保存し、finishで可変の最終状態から過去を再構成しません。

比較表現・型付きデータ・identityを[値の比較](../reference/value-comparison.md)の規則で保持します。期待値や先行結果が後続変更に追従することを防ぎます。

## 正常終了・例外の期待

終了期待はreturn / throw / return-or-throwです。outcome由来のrefがあればreturn-or-throw、error条件または例外refがあればthrow、それ以外はreturnです。単一実行ではその対象、明示的な最終操作のあるstepsでは最後の操作が終了期待の対象です。

stepsの通常のargsは全て正常完了を要求します。最後に一度だけfinalを記述し、そのFinalStepRefを直接または返却レコードへ含めれば、最後だけerror（it/property）またはoutcome（property）で検査できます。error/outcomeがなければfinalもreturnを期待します。複数final・後続操作・返却されないfinalはcompileで拒否します。FinalStepRefを次の操作へ渡すことはできません。

最後のerror/outcomeと、最後の正常resultに依存する条件・観測は混在できません。先行操作の成功結果は併用できます。compileでrefの元操作と依存を追跡し、返却レコード全体が最後の正常結果を含む場合も拒否します。

| 終了 | 結果の検証 | 効果の観測 |
|---|---|---|
| 正常 | 期待対象のresultまたはoutcomeのreturn枝。error期待なら不一致 | 引数が揃う観測を実行 |
| 単一対象または明示的な最終操作のthrow/reject | errorまたはoutcomeのthrow枝。正常期待なら不一致 | 定数・input（単一実行）・sample・先行成功結果に依存する観測を継続 |
| stepsの先行操作のthrow、またはfinalなしの操作のthrow | 予期しない失敗。明示的な最終操作があれば未実行として記録。最後のerrorを満たさない | 既に得た結果・sample・引数非依存の観測を継続 |
| timeout/中断 | error期待で成功にできない | 未完了を未評価として解放 |

finalが終了を検査する範囲は、その対象関数の呼び出しと戻ったPromiseのsettleだけです。引数refの解決、結果保存、checkpoint、環境・検証の失敗を対象のthrowへ変換しません。先行操作の例外型が期待と一致しても、最後のerror/outcomeへ代入しません。

error.ofTypeとoutcome.withErrorは、期待対象のthrow/rejectが得られた時点でinstanceofを検査します。不一致は条件失敗で、射影・field取得・述語は実行しません。合致した場合だけ元の例外から必要なデータを保存します。射影の失敗は観測障害です。環境・実行器の失敗やtimeoutをoutcomeのthrow枝に入れません。

明示的な最終操作の後はafter-planで観測し、after(stepRef)は先行の通常操作だけに使えます。取得できなかった結果を引数にする観測は未評価とし、空の状態や履歴へ置き換えません。targetを開始していない場合も不発生の成功にはしません。

## 途中の失敗

| 段階 | 扱い |
|---|---|
| prepare/compile/before | targetを開始せず取得済み資源・セッションを解放 |
| target | 終了種別に従って照合と観測 |
| checkpoint | 取得不能なら後続操作を止め、取得可能な後観測と解放を続行 |
| observe | 該当条件の観測障害。他の独立した観測は続行 |
| assert | 不一致・述語例外を保持し、他の条件を続行 |
| cleanup | 元の失敗も保持し、残りの解放を試みて後続を中断 |

open途中で失敗しセッションを返せない場合、その提供者が部分取得した資源を解放します。試行期限超過等では待機を止め、未完了を成功に変換しません。

## middlewareとnext

middleware/environmentはnextを一度呼び、その完了値を返します。後処理にはreturn await nextを使って下流を待ちます。未呼出し・複数呼出し・早すぎる終了は実行時にも検査します。catchしても記録済みの失敗は消えません。

scopeはnext以前に観測器を発行し、所有者は評価単位です。同じattempt内でも別候補のトークンを持ち込めません。前評価の解放後に共有資源から新しい観測器を作れます。

## 証拠の種類

evidenceは環境が選んだ観測点の宣言で、real-effect/substitute-effect/call-recordをそのまま記録します。state/actionの形から証拠の強さを自動認定しません。直接観測できない場合のcall-recordを受信・永続化の保証へ格上げしません。

## 生成入力と再試行

propertyはseedからruns件を順に生成します。既定runsは固定入力源で1、その他で100、maxShrinks=1000です。seedは安全な整数、runsは正の安全な整数、maxShrinksは0以上の安全な整数です。省略seedも結果へ残します。

constantは定義時にデータを保存し、評価ごとにコピーします。constantのみのtuples/recordと空タプルは固定入力源で、縮小候補を持ちません。boolean、record、oneOfを含む生成記述も定義に保持します。oneOfは非空で、縮小してもいずれかの選択肢が表す範囲内です。

最初の契約違反で通常生成を止め、範囲内の縮小候補を評価します。同じ条件indexの不一致、または同じ操作位置の予期しない終了を再現した候補だけを採用します。最大maxShrinks回で探索を止め、残した反例が大域的に最小とは報告しません。

各生成例・縮小候補はprepareからcleanupまで独立です。propertyのsteps内の操作間では状態を保ちます。準備・compile・観測器・述語・後始末の例外や試行timeoutは縮小する契約違反ではなく、探索を止める検証基盤の失敗です。元の反例と追加の失敗を両方保持します。

retryでは同じseed・設定・生成器形式で探索を最初から行います。保存するのは資源を含まないsampleで、argsFromやfromが環境を供給します。targetの入力変更で再現データを更新しません。

## skip / todo / only

定義を収集しますが、skip/todoでは環境・観測・targetを開始しません。onlyは提供されるitの選択で、検証の意味を変えません。

## 診断

条件はsource: expectと配列内indexで対応します。評価番号・入力・比較方法・観測引数・時点・evidence・実測値・原因を残します。compileできなかった条件を捏造しません。
