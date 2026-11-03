# 型推論

対象の形、pure/effectfulの特性、it/propertyのケース種類を別の型情報として保持します。[公開構文と禁止例](../guides/writing-tests.md)が契約です。

## 対象とコンテキスト

| 宣言 | 決まるもの |
|---|---|
| target(fn) / target(obj, key) | 単一の対象、Parameters、Awaited ReturnType。省略時pure |
| target(relation(functions)) | 純粋変換の法則が使う非空の関数集合 |
| target(scenario(operations)) | 順序を持つケースで使う非空の公開操作集合。省略時pure |
| pure() / effectful() | 対象の特性。明示は一度だけ |
| it / each | 具体例のビルダー。eachは行からrowを推論 |
| property | 入力生成と性質検査のビルダー |
| use(middleware(...)) | next(fields)から後続コンテキストを推論 |
| use(environment(...)) | effectfulのみ。評価固有のState/Action/Boundaryも供給 |

relationはpure専用で、propertyと法則を記述します。effectfulな複数操作はscenarioを選びます。関数自身の型やアプリ側の宣言を書き換える必要はありません。

## 特性の宣言

省略時pureと明示pureの使える操作・実行意味は同じです。ただしビルダーは明示済みかを型で保持し、未宣言の間だけpure/effectfulを一度選べます。最初のit / property / each / only / skip / todoで固定し、その後は両メソッドを提供しません。同じ宣言の重複も禁止です。

pureの省略状態からeffectfulを選べます。選ぶ前にenvironmentを付けることはできません。middleware・require・timeout等は宣言済みフラグを保持して派生します。イミュータブルな元のビルダーから別の派生を作ることは可能です。

## middlewareから型を伝える

middleware/environmentのnext(fields)からフィールドを推論し、後続へ合成します。フィールドはreadonly、参照先の資源は浅く渡します。状態/actionの保存値は別にコピーします。

environmentはeffectfulを宣言した対象のuseに限り、scopeで評価トークンを発行します。groupへenvironmentを渡すこと、pureへ親からenvironmentを注入することはできません。高価な資源はgroup middlewareやresourceで共有し、子のenvironmentで各評価の初期化と観測を用意します。

## 設定とケース追加を分ける

| ケース | 入力・操作の前 | 入力・操作の後 | 完成条件 |
|---|---|---|---|
| 単一targetのit/each | args / argsFrom、実行設定。effectfulならreplace | expect、effectfulならexpectCalls | 完成した条件が1件以上 |
| scenarioのit | steps、実行設定。effectfulならreplace | expect、effectfulならexpectCalls | stepsが返すrefと条件が1件以上 |
| 単一targetのproperty | forAll、実行設定。effectfulならreplace | 必要ならargsFrom、その後expect。effectfulならexpectCalls | forAllと条件が1件以上 |
| pure単一のproperty・標準法則 | forAll、実行設定 | law(idempotent()) | 対象と入力の型に適合する法則 |
| relationのproperty | forAll、実行設定 | law(roundTrip(...)) | 構成要素の型と入力に適合する法則 |
| scenarioのproperty | forAll、実行設定。effectfulならreplace | steps、その後expect。effectfulならexpectCalls | forAll・操作列・条件が1件以上 |

propertyとitは同じSuiteへ追加できます。ケース内のproperty、relate、calls、Suiteのflowは提供しません。scenarioもit/propertyを使い、対象の形がstepsを利用できるかを決めます。

単一targetのpropertyでargsFromを省略できるのは、生成タプルが対象のParametersへ適合する場合だけです。適合しないforAllの後はargsFromで束縛するまでexpectを提供しません。argsFrom(ctx, sample)の戻り値をParametersへ検査します。scenarioではsampleからs.inputを、宣言した操作からsの各メソッドを推論します。

lawとexpect/expectCalls/argsFrom/stepsは択一です。idempotentはpureな単一引数関数で正常結果を再入力できること、roundTripは宣言した二つの単一引数関数を型の適合する順に合成できることを要求します。

## 完成条件

expect/expectCallsは各ケースに一度だけ、順序は任意で、返却する条件配列は非空です。入力なしのitにもargs()を明示します。propertyは空の引数でもforAll(tuples())を明示します。

状態のみ・actionのみ・境界呼び出しのみでも完成できます。戻り値のダミー検証や全責任の網羅を要求しません。error条件がなければ正常終了を期待します。

errorとresult由来の条件は混在できません。errorとinput/sample・状態/action・境界の条件は併用できます。propertyも例外についての性質を検証できます。scenarioとlawは全操作の正常完了を期待し、errorを提供しません。

actionの区間指定だけ、eventuallyだけ、forAllだけでは未完了です。各条件の終端操作と必要な入力/操作を揃えるまで登録できません。

## ケースごとの期待の型

itのexpectは具体値・部分・例外・状態/actionだけを提供します。propertyのexpectにはon(ref).satisfies/inRangeと、ref同士のequal/different/sameReference/differentReference/lessThanも提供します。これらをitに持ち込むことはできません。expectは素のbooleanを受け取りません。

itとpropertyの条件はケース種類と所有者に紐づきます。型で種類の混用を拒否し、同じ型でも別ケース・別評価のrefや条件を混ぜた場合はcompileで拒否します。

## 参照と記述子の型

State<T>、Action<E>、Boundary<F>、各条件とrefはブランドで区別します。input/result/valueはLiveRef、sample/state/before/actionはSnapshotRefです。結果レコードの合成rootはSnapshotRefで、fieldで選ぶ操作結果は元の出自を保ちます。

参照同一性の比較はLiveRef同士だけです。コピーしたstate等を渡すことを型・compileで拒否します。field/partのキーと、境界の引数は元の型から検査します。省略可能フィールドはundefinedの可能性を保持します。

値比較はrefの出自に応じた時点の保存値を使い、後から可変値を読み直しません。期待値もcompile時に保存します。[値領域](../guides/writing-tests.md#スナップショットの値領域)にないクラスや関数をコピー後も元の型であると偽りません。静的に分かる不正は型で、prototype等は取得時にも検査します。

## グループとコンテキスト

独立した子はnew Test<R>()で必要な値を要求します。親の供給と必要になる時点を検査し、要求の残る子を単独登録できません。group前処理は後で開始する評価のmiddlewareへ依存できません。

## 型の限界

pure宣言の真偽、任意述語が恒真でないこと、環境の接続先や業務上のinfra境界の妥当性は自動証明しません。許された拡張口に信頼を置くことと、ケース内の任意介入を許すことは別です。

同一性・循環・数値範囲・観測期間・トークンの寿命・コピー可能性は、実行受付または対応する段階で検査します。型を回避した不正を成功へ変換しません。

## 検証

許可例と禁止例を型契約へ落とし、補完に出る操作もケース種類と特性に一致させます。動的な所有者・観測障害・生成/縮小の実行は[実行仕様](../concepts/semantics.md)に従います。

## each・実行設定・sequence

eachは単一targetの具体例の省略形です。forAllはpropertyだけ、stepsはscenarioだけに提供します。特性はtarget側で固定され、行や生成例で切り替えられません。境界のonce列には通常動作を必須とします。
