# ケースの記述

一つのケースは契約の一側面を検証します。[公開構文](../guides/writing-tests.md)と[型の完成条件](type-inference.md#完成条件)が記述の契約です。

## args / argsFrom

対象のParametersに対応する引数を指定します。argsFromには環境準備後のctxを渡します。両者とcalls / forAll / stepsは択一です。引数なしでもargs()を明示します。

## calls

pure単一・relationに提供します。対象に限定した呼び出しと、その結果参照を使う依存グラフを返します。ctxは渡しません。状態を変える順序列には使えません。[複数呼び出し](../guides/multiple-calls.md)に従います。

## steps

scenarioのflowにだけ提供します。s.ctxと対象操作を使って同期的に操作列を記述し、結果refまたは非空のレコードを返します。全操作を宣言順に実行し、未使用結果の操作も省略しません。[flow](../guides/flow.md)に従います。

## forAll

pure単一のitにだけ提供します。ブランド付きの生成記述、seed、runsを指定し、propertyまたはrelateを必要とします。入力生成を具体値の曖昧な期待で代替しません。[生成入力](../guides/writing-tests.md#性質)に従います。

## 期待と観測

expectは具体値・部分・例外・状態/actionの条件、propertyは名前付きの性質、relateはref間の関係を返します。異なる種類の条件を混ぜることはできません。状態のみ・actionのみで完成でき、戻り値のダミー期待を要求しません。

各入口は一度だけ指定でき、空でない配列を返します。返した条件だけを検証し、完成していない区間・待機指定や、呼び忘れを受け付けません。各ビルダーはprepare後・target前に評価し、実測値ではなく型付きrefと観測条件を構築します。

## expect / expectCalls

expectCallsはeffect/scenarioで、環境が提供したBoundaryへの条件だけを返せます。純粋関数や任意object/keyには提供しません。境界の呼び出し記録は状態/actionの観測記述に変換できません。

errorがなければ正常終了を期待します。errorと状態/action/expectCallsは併用できます。errorとresult/property/relateは混在できず、calls/scenarioにはerrorを提供しません。

## mock

任意mockはありません。入力/操作前にreplaceで許可された境界の応答を設定します。同じ境界のreplaceは一度だけで、対象自身や操作集合の構成要素は置換できません。

## timeout / retry

入力/操作を決める前に個別の期限・再試行回数を設定します。retryはケース全体、eventuallyは状態の読み取りだけを繰り返します。

## 呼び出し条件を先に構造化する

compileで境界トークンと条件を解決し、beforeの観測準備後に記録を設定します。記録対象はtarget開始からsettleまでです。argsFromや観測器の動作を対象の呼び出しへ混ぜません。

## 結果の期待を組み立てる時点

検証ビルダーはtarget前に評価します。e.ctxは実環境、e.resultは実測値を持たない条件ビルダーです。property/relateもrefを組み立てるだけで、述語の実行・比較は必要な観測値が得られた後です。ビルダーのthrowをtargetの期待した例外にはしません。
