# 期待と観測

expectはit/propertyのケース内で使います。itは具体値・部分・許容誤差、propertyはそれらとon(refs).satisfiesによる性質を記述します。共通not、ケース内property/relateはありません。

## result

結果の型は対象から推論します。toEqualは標準の構造等価、toBeはObject.is、toBeCloseToは指定した絶対許容誤差を検証します。toEqualの値領域をプレーンデータだけに制限しません。[値の比較](value-comparison.md)に従います。

part(key)は部分の期待、field(key)は観測引数やpropertyで使うrefです。どちらも型に存在するキーを選び、nullableな値の欠落はmissingとして記録します。missingとundefinedは区別します。明示したgetterの取得がthrowした場合は観測失敗です。

## 部分・性質・関係

propertyのonはrefまたは非空の名前付きrefレコードを受け取ります。satisfies(name, predicate)は保存したデータに対する同期booleanの述語です。入力・結果・状態等の関係も同じ方式で書きます。比較方法の別系列や閉じたlaw集合を必要にしません。

onへ渡すrefには少なくともその評価の正常結果・型を絞った例外・outcomeまたは実行後の観測値を含めます。入力・定数だけでtargetを検証した扱いにできません。判定の意味そのものや恒真でないことは自動証明しません。

独自クラスのデータはpropertyのproject(ref, value => data)で投影できます。射影は元refの取得時点で行います。identity(ref)は生の同一性をopaqueなIdentityRefへ変換し、プロパティを読み直すためには使えません。state/action/sample/投影値へのidentityは拒否します。

## error

error.toEqual(value)、error.message.toEqual(text)を使えます。独自例外はerror.ofType(Ctor).part(key)で、型を絞った公開データを照合します。ofTypeはinstanceofも検証し、不一致ならその条件を失敗にします。スタックはtoEqualの等価性に含めません。

propertyではerror.ofType(Ctor)とそのfield(key)をrefとしてon/projectへ渡せます。例外refを含む条件はthrow/rejectを期待し、ofTypeのinstanceofも条件の一部として検証します。型が違えば条件不一致とし、後続のfield取得や述語は実行しません。正常終了なら終了種別の不一致として失敗します。

errorと同じ終了対象の正常result由来のrefは混在できません。その結果を引数にする観測も同様です。input/sample依存の状態やactionは併用できます。stepsでは先行操作の正常終了を期待し、finalで指定した最終操作だけをerrorで照合できます。前段の例外は最後のerror条件を満たしません。

## outcome

単一実行、または明示的な最終操作を持つpropertyで、正常と例外の混在する入力範囲を扱います。Rは終了期待の対象（単一実行または明示的な最終操作）の戻り値型で、e.outcomeはRef<{ kind: 'return'; value: R } | { kind: 'throw'; error: unknown }>です。直接onへは渡さず、kindのfield、withError、またはprojectで型付きの保存データを指定します。

outcome.withError(Ctor, projectError?)は正常側のvalueを保持し、例外側をinstanceof Ctorで検査してから射影します。省略時のerrorはnullです。型不一致は条件失敗、射影のthrowは観測障害であり、どちらもfalseや成功へ変換しません。型付きコピーできない正常値も、必要ならprojectでデータへ投影してonに渡します。

outcome由来のrefを含む条件があれば、期待する終了はreturn-or-throwです。同じ終了対象のresult/error条件・ref（観測引数やprojectでの使用も含む）とは混在できません。stepsの先行成功結果のrefは併用できます。input/sampleとそれらに依存する観測は使えます。itとfinalなしのstepsには提供しません。対象以外の失敗・実行timeoutをthrowの正常な枝として渡しません。

stepsの返却レコードでは、明示的な最終操作フィールドは最後の正常結果、他のフィールドは先行成功結果を指します。レコード全体が最後の正常結果を含む場合、その全体refはerror/outcomeと併用できません。e.error/e.outcomeは最終操作だけを表し、前段の例外を拾いません。propertyのoutcome.valueは最終操作の戻り値型です。

## refの入口

単一実行のit/propertyではinput(index)が対象へ束縛した引数を指します。sample(index)はpropertyだけで、生成データを指します。stepsには一意の引数タプルがないためinputを提供しません。resultは正常結果、field(key)はその部分、value(value)はcompile時に保存した定数です。

propertyではerror.ofType(Ctor)/field(key)も失敗のrefとしてon/projectに使えます。型付き保存できない例外クラス全体はprojectで必要なデータへ投影します。この例外refは観測引数・before・afterには提供せず、単一実行または明示的な最終操作を持つpropertyの条件に限定します。

itではこれらを結果依存の観測引数に使えます。propertyではon/projectにも渡せます。state(token,...args)は計画完了後の値、.before()は実行前の値、.after(stepRef)は指定操作直後の値を参照します。beforeはproperty専用で、後値や実行結果と関係を記述するために使います。beforeだけの条件をtargetの検証として完成させません。

区間を指定したactionもpropertyのon/projectへ渡せます。eventuallyで待機する状態はrefにせず、toEqual等の単独条件にします。refの時点・所有者・型は[型推論](type-inference.md#refの入口)に従います。

## 状態

scope.state({ evidence, read })はreadの引数と戻り値を型として持ちます。e.state(token, ...args)のargsには型の合う定数またはinput/sample/result/操作結果のrefを渡します。引数には型付きコピー可能なデータを使い、別の状態/actionの結果に依存する観測グラフは作りません。

通常は対象計画全体のsettle後に引数を解決して読みます。before/unchangedは実行前にも同じ保存した引数で読むため、result依存の引数を拒否します。state(...).after(stepRef)はその操作の完了直後に読む指定で、引数がその時点までに得られることをcompileで確認します。未実行の操作の観測は未評価です。afterは通常の先行操作のrefに限り、FinalStepRefをチェックポイントに使いません。最終操作の後はafter-planで観測します。

toEqual、part(key).toEqual、unchangedを提供します。eventually({ withinMs, intervalMs })の後はtoEqual/partだけで、afterやunchangedとの併用はありません。正の有限値かつintervalMs <= withinMsを要求します。状態の読み取りだけを再試行し、取得失敗を不一致として再試行しません。

## action

scope.action({ evidence, open })のopenはtarget前に開始し、finishとdisposeを返します。finishは一度だけ履歴を確定し、disposeは成否にかかわらず解放します。環境は発生時点の値を独立して記録し、targetが編集できる最終配列だけを履歴にしません。

action(token).untilTargetSettles()またはforAfterTarget(ms)で記録区間を指定し、toEqual(events)・count(n)・none()を照合します。countは0以上の安全な整数です。同じトークンの矛盾した区間は拒否し、条件が早く成立しても区間を短縮しません。

## 証拠と呼び出し記録

state/actionは時間的な観測形態です。evidenceはreal-effect（本物のtarget自身または置換していない資源の状態）、substitute-effect（fakeの契約モデルの状態）、call-record（依存へ渡された引数・回数の記録）として環境が別に宣言します。プロセス内外による分類ではありません。観測APIの形だけで、本物の外部効果を観測したと判断しません。caseからevidenceの変更はできません。

呼び出し記録が必要なら環境がその履歴を観測トークンとして提供し、call-recordと表示します。expectCallsや任意メソッドをspyするAPIはありません。どこを観測しているかの意味は環境提供者の責任であり、宣言の真偽をフレームワークが自動認証するものではありません。

## 呼び出し

呼び出しの記録は前節のcall-recordとして扱います。実効果を直接観測できない場合の代替の証拠であり、受信・永続化を保証したとは報告しません。[環境の代替](api-mock.md)に従います。

## 否定

具体値の期待に共通notはありません。性質の不一致条件はproperty、状態の不変はunchanged、出来事の不発生は有限区間のnoneで記述します。観測失敗を反転して成功にはしません。

## middlewareで生成した参照・値を検証する

環境のscopeが評価ごとにstate/actionを発行し、ctxからケースへ渡します。別評価のトークンやrefの持ち込みを拒否します。観測の定数引数と期待値はcompileで保存し、結果の引数refは利用可能になるまで実行を延期します。

## コンテキスト

expectはprepare後・target前に構築します。ctxは実環境、結果等はrefです。述語から可変ctxを期待として読み直さず、保存した入力・結果・valueを使います。インスタンス供給のfromもこの段階で解決します。

## 期待値の保存

期待値はcompile、実測値は各取得時点に、独立した比較表現へ保存します。toBeだけは生の参照を扱います。型付きデータのコピーと比較表現を混同しません。[比較と保存](value-comparison.md)に従います。

## 深い一致と評価

部分のキー経路、値アダプター、観測引数・時点・evidenceを診断に残します。不一致、取得不能、述語例外、未実行のための未評価を区別します。propertyでは入力・反例・縮小情報を結果へ残します。
