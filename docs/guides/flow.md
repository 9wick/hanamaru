# 操作列の具体例と性質

複数実行の記述はstepsに統一します。itとpropertyのケース種類は変えず、対象の特性と形でstepsを提供する場所を決めます。

## 関数の契約とシナリオを分ける

単一targetのitは一回の具体入力です。単一targetのpropertyはs.targetでその対象を繰り返せます。scenarioは対象集合で、pure/effectfulとも具体的な操作列のitとpropertyを持ちます。

## 対象範囲を明示する

scenario({ create, update })で関数を宣言します。評価ごとに作るinstanceメソッドはmethod(Class,key)を要素にし、from(ctx => receiverMap)で供給します。例は[対象の指定](../reference/api-test.md#テスト対象を指定する-target)に従います。

scenarioのitでもon/satisfiesのような任意の性質条件は使えません。具体的な入力と期待値を持つ回帰例なら、対象がpureでも記述できます。対象の回数とケース種類を混同しません。

## 操作と観測を書く

s.inputはpropertyの生成タプル、s.ctxは環境です。結果refは先行操作の入力へ渡せます。全操作を宣言順に実行し、返却しない操作も省略しません。

観測用のreadを対象集合へ追加する必要はありません。stateの引数へ結果refを渡し、計画完了後の状態を読みます。途中はstate(...).after(stepRef)で指定操作の後に観測し、その保存値を比較します。[effectfulな冪等性の例](writing-tests.md#操作列)に従います。

## 待機と再実行

観測の待機でtargetを再実行しません。actionは操作列全体を囲み、afterのstateは一度だけ読みます。propertyは各候補で環境を作り直しますが、候補内の操作間では状態を引き継ぎます。

## 結果と後始末

通常のstepsは全操作の正常完了を期待します。最後をfinalにしてそのrefを返せば、最後だけerrorまたはpropertyのoutcomeで検証できます。前段のthrow/rejectは後続を止める失敗で、最後の期待へ流用しません。Result型の失敗値は正常結果です。結果依存の観測は引数が得られたものだけを実行し、他は理由付きの未評価にします。後始末不能なら次の評価へ進みません。

二重登録や遷移違反は、[公開操作の後の失敗の例](writing-tests.md#公開操作の後の失敗を検証する)のように前段を通常の操作、最後をfinalにします。生成値で作る前提も各候補のsteps内に置け、環境の内部状態へ直接seedする必要はありません。
