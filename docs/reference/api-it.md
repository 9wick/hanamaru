# ケースの記述

itとpropertyはtarget配下で並ぶケース定義の入口です。どちらも一つの契約の一側面を検証できます。[具体的な構文](../guides/writing-tests.md)と[型の完成条件](type-inference.md#完成条件)に従います。

## args / argsFrom

単一targetのitでは、args(...values)またはargsFrom(ctx => tuple)を一度指定します。引数なしにもargs()を要求します。型は対象のParametersに従います。

単一targetのpropertyではforAllの生成タプルをそのまま渡すか、argsFrom((ctx, sample) => tuple)で実資源を添えて束縛します。固定のargsは提供しません。argsFromは生成例ごとにprepare後・target前に評価します。

## propertyとforAll

property(name, p => p.forAll(source, options).expect(...))と書きます。forAllはpropertyに一度だけ使え、itにはありません。pure/effectfulのどちらにも使えます。法則による検査ではexpectの代わりにlawを選びます。

## law

pureな単一関数のidempotent、pureなrelationのroundTripを指定できます。forAllの入力型と法則の適用条件を検査します。lawとargsFrom/steps/expect/expectCallsは併用できません。法則が実行と照合を所有し、ケースから任意関数を呼べません。

## steps

scenarioだけに提供します。itではs.ctxから具体的な操作を記述し、propertyではforAllのsampleをs.inputとして使えます。定義コールバックは同期的に操作記述を作り、実測値による分岐や任意関数の追加はできません。返すのは操作結果のrefまたは非空の名前付きレコードです。

実行器は全操作を宣言順にawaitし、未使用の戻り値を理由に操作を省略しません。複数実行の性質を記述する自由なcallsは提供しません。[操作列](../guides/flow.md)に従います。

## 期待と観測

expectはitでもpropertyでも使いますが、渡すビルダーの型が違います。itは具体値・部分・例外・状態/action、propertyはそれらに加えてrefの性質・関係条件を提供します。propertyやrelateというケース内の検証操作はありません。

条件配列は非空で、各条件を終端操作まで完成させます。状態のみ・actionのみでも完成でき、戻り値のダミー検証は要求しません。lawはそれ自体が完成した検査です。

## expect / expectCalls

各入口はケースに一度だけです。expectCallsはeffectfulなit/propertyだけで、許可済みBoundaryの呼び出し条件を受け取ります。効果の観測へ変換することはできません。

errorがなければ正常終了を期待します。errorと正常結果refの混在は拒否しますが、errorと状態/action/境界条件は併用できます。scenarioとlawの途中の例外は常に失敗です。

## mock

effectfulなケースだけがreplace(ctx => ctx.boundary, behavior)を入力/生成/操作の指定前に置けます。生成例や縮小候補ごとに境界を再解決します。内部関数を任意に指定するmockはありません。

## timeout / retry

ケースの入力/forAll/stepsの前に設定します。retryはpropertyの生成・縮小を含むケース全体、eventuallyは状態取得だけの再試行です。

## 呼び出し条件を先に構造化する

prepare後のcompileで境界トークンとexpect/expectCallsを解決し、必要な観測をtarget前に開始します。境界呼び出しの記録はtarget開始からsettleまでで、argsFrom・観測器・検証処理を含めません。

## 結果の期待を組み立てる時点

expectのビルダーはtarget前に評価します。ctxは準備された環境、resultやinput等は実測値ではなく型付きのrefです。値の取得と保存の後に条件を照合します。ビルダーの失敗をtargetが期待どおり失敗したことにはしません。
