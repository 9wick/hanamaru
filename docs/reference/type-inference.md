# 型推論

対象の形、pure/effectful、it/propertyを別々の型情報にします。具体的な[許可例と禁止例](../guides/writing-tests.md)に従います。

## 対象とコンテキスト

| 指定 | 型と制約 |
|---|---|
| target(fn) / target(obj, key) | 対象のParametersとAwaited ReturnType。固定した関数または受け手 |
| target(Class, key).from(resolver) | 宣言したinstanceメソッドの型。fromで供給するinstance型を照合 |
| target(scenario(operations)) | 宣言キーごとの引数と結果型。method記述子にはreceiverの供給が必要 |
| pure()/effectful() | 特性。省略はpure。明示一度、ケース前 |
| use(middleware(...)) | next(fields)からコンテキストを推論 |
| use(environment(...)) | effectfulのみ。依存、state/action等を供給 |

class形式では、fromがない定義へケースを追加できません。useでctxを推論した後にfromを指定し、別クラスを返すresolverを拒否します。scenarioのfromはmethod記述子のキーと対応したinstanceマップを要求します。通常関数のキーにreceiverを追加できません。

## 特性の宣言

省略pureと明示pureの実行意味は同じです。明示済みフラグは型に保持し、pure().pure()やpure().effectful()を拒否します。最初のケース以降は両操作を提供しません。environmentを使う前にeffectfulを選びます。

## 設定とケース追加を分ける

| 対象とケース | 入力・操作 | 完成条件 |
|---|---|---|
| 単一targetのit/each | args / argsFrom | expectに1件以上の条件 |
| 単一targetのproperty | forAll、そのまま単一実行またはargsFromまたはsteps | expectに1件以上の条件 |
| pureなscenarioのit | steps | expectに1件以上の具体値等の条件 |
| pureなscenarioのproperty | forAll + steps | expectに1件以上の条件 |
| effectfulなscenarioのit | steps | expectに1件以上の具体値等の条件 |
| effectfulなscenarioのproperty | forAll + steps | expectに1件以上の条件 |

単一targetのitにsteps、scenarioにeach、itにforAllや任意述語を提供しません。relation/lawという別の閉じた経路はありません。scenarioのitでも任意述語を持ち込めません。対象限定の操作列の具体例を、回数だけを理由に禁止しません。

propertyで生成タプルがParametersへ適合しない場合はargsFromまたはstepsが必要です。argsFromとstepsは択一です。stepsのs.targetまたは宣言キーだけを呼べ、任意の関数を渡すcallはありません。s.inputはcompile時の具体値で、そこからsampleの型、s.ctxから環境の型を推論します。

## stepsの明示的な最終操作

通常のargs呼び出しはCallRef<R>、final(...args)はFinalStepRef<R>を返します。FinalStepRefは他操作への引数・field操作に使えず、stepsの返却にだけ使えます。単独か、先行CallRefと同じ平坦な非空レコードの一フィールドとして返します。

error/outcomeを使わないfinalも許し、その場合はreturnを期待します。一つのfinalが最後の操作で、返却に含まれることをcompileで検査します。コールバック内の命令順を型だけで保証しません。二つのfinal、後続操作、返されないfinalは対象開始前に拒否します。

返却型から、e.resultのどのfieldが最終の正常結果に依存するかを追跡します。最終error/outcomeとそのfieldまたはそのfieldを含む全体refは混在できません。先行成功結果のfieldは混在できます。明示的な最終操作がなければerror/outcomeを提供しません。propertyのoutcome.valueは最終操作自身のRで、返却レコードの型ではありません。

## 完成条件

入力/操作と非空のexpectを必要とします。state/actionのみでも完成し、全責任の網羅は要求しません。環境や期待を設定した後に入力を変更できません。timeout/retryは入力/生成/操作の前に指定します。

区間指定・eventually・forAllだけでは完成しません。todoは実行しない別の定義です。errorと同じ終了対象の正常result由来の条件や観測引数を混在できません。stepsはfinalで指定した最終操作だけにerrorを提供します。

part/fieldはNonNullable<T>のキーから選びます。実測値がnull等でその経路が存在しなければmissingとして照合し、undefinedとは区別します。

## refの入口

| 入口 | 利用箇所・意味 |
|---|---|
| e.input(index) | 単一実行のit/property。実際に束縛した引数へのref。stepsには提供しない |
| e.sample(index) | property。生成またはconstantのデータへのref |
| e.result / field(key) | 正常結果または返却した操作結果。fieldは部分のref |
| e.value(value) | compile時に保存する定数ref |
| e.outcome / withError(Ctor, projectError?) | 単一実行または明示的な最終操作を持つproperty。return/throwの判別union。withErrorはthrow側だけ型検査・データ化する |
| e.error.ofType(Ctor) / field(key) | 単一実行または明示的な最終操作を持つproperty。指定した例外型またはそのフィールドへのref。on/projectに使える |
| e.state(token,...args) | 計画完了後の観測。条件として照合でき、propertyではon/projectに渡せるrefでもある |
| e.state(...).before() | propertyの前値ref。結果非依存の引数のみで、on/projectで後値等と組み合わせる |
| e.state(...).after(stepRef) | 指定操作直後の観測。条件またはpropertyのon/project用ref |
| e.action(token).untilTargetSettles()/forAfterTarget(ms) | 区間内の出来事。条件またはpropertyのon/project用ref |

beforeとafterは同じ観測に同時指定できません。eventually付きビルダーは単独の終端条件を必要とし、refとしてon/projectへ渡せません。onの入力には正常結果・型を絞った例外・outcome・実行後/操作後の観測のいずれかを含め、beforeやinputだけでは完成条件になりません。

例外refを使う条件はthrow/rejectの期待を持ちます。refレコード内や別条件に同じ終了対象の正常resultが含まれる混在を型とcompileで拒否します。error.ofType(Ctor)はinstanceofを検証してからfieldやprojectを解決し、不一致ならその条件を失敗にします。明示的な最終操作のないstepsと観測引数には例外refを提供しません。

outcomeを含む条件はreturn-or-throwを期待します。同じ終了対象のresult/error条件や、それらのrefを経由する観測との混在を型とcompileで拒否します。withErrorのprojectErrorはinstanceofで絞った例外型を受け、その戻り値型がthrow側のerrorになります。省略時はnullです。正常側のvalueは終了期待の対象（単一実行または明示的な最終操作）の戻り値型を保ちます。

生のoutcomeはerrorがunknownのrefなので直接onに渡せません。field('kind')、withError、またはprojectで保存できるデータを選びます。withErrorの正常値が独自クラスなら、通常の保存規則どおりprojectを必要とします。outcomeは明示的な最終操作のないsteps・it・観測引数へ提供しません。

## 観測の型と時点

State<Args, Value>はread関数から推論します。state(token,...args)で引数の数・型を検査し、定数か、対象のinput/sample/result/step結果refを受け付けます。観測の引数は型付きコピー可能なデータです。他のstate/actionを引数にした依存グラフは拒否します。

state(...).before()/unchangedは実行前に使えるrefだけを受け付け、result引数を拒否します。after(stepRef)は通常の先行操作に限り、その操作以前に引数が揃うことをcompileでも確認します。明示的な最終操作の後は計画完了後の観測を使います。未実行操作に紐づく観測は未評価です。異なる評価のトークン・ref・条件を拒否します。

## ケースごとの期待の型

itは具体値・部分・許容誤差・状態/actionを持ち、例外は単一実行または明示的な最終操作に提供します。propertyはon(refs).satisfiesも持ちます。素のbooleanは条件として受け付けません。onの入力には実際の正常結果・例外・outcome・実行後の観測値のいずれかを含め、入力だけを条件にしません。

propertyのonへ独自クラスを不正な複製型で渡しません。必要ならprojectでDTOに投影し、その返り値型を使います。identityは入力・結果・定数の生の参照からopaque objectを作り、観測済みコピーには提供しません。[比較と保存](value-comparison.md)に従います。

## middlewareから型を伝える

next(fields)から後続の型を推論し、同名は内側が置換します。値を供給できるのはmiddlewareと、effectfulのenvironmentです。nextの完了値を返すことを型で要求し、呼び出し回数・待機は実行時にも検査します。

## グループとコンテキスト

独立した子はnew Test<R>()で必要な値だけを要求します。供給時点を型で検査し、未供給の子を単独登録できません。groupでは共有資源を用意し、子のenvironmentが各評価を初期化します。

## 型の限界

関数の純粋性、述語の意味、観測点とevidenceの真実性、fakeの契約適合は提供者とレビューの責務です。型は呼べる対象・記述の種類・引数と結果・トークンの権限を限定します。フレームワークが任意コードの実行をsandbox化する保証ではありません。

## 検証

利用例と禁止例を型契約へ落とし、補完も用途に合わせます。動的な同一性・期間・保存・供給失敗は[実行仕様](../concepts/semantics.md)に従います。

## 固定入力と生成

propertyはforAllにconstant/record/boolean/oneOf等も使えます。constantだけで構成するtuples/recordと空タプルは、runs省略時に一評価で縮小しません。固定入力の性質をargsFromへ隠す必要はありません。単一実行のpropertyでは直接のタプルかargsFromで対象の引数へ対応させます。

## each・実行設定

eachは単一targetの具体例の省略形で、特性は行ごとに変わりません。propertyの候補ごとに環境を初期化し、試行期限とretryは探索全体に適用します。
