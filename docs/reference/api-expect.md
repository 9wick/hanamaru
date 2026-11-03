# 期待と観測

expectはitとpropertyの中で使います。ケースを定義するpropertyと、期待を記述するexpectを同列にしません。[具体例と禁止例](../guides/writing-tests.md)が公開構文です。

## result

戻り値の型は対象のAwaited ReturnTypeから推論します。itではresult.toEqual(value)またはtoBe(value)で具体値を指定します。propertyでも同じ期待を書けますが、生成入力に対する条件には以下の性質・関係の操作を使えます。

結果が関数なら関数値として扱い、期待値を述語として実行しません。Result型の失敗値は通常の戻り値です。

## 部分・性質・関係

| 操作 | it | property |
|---|---|---|
| result.part(key).toEqual(value) | 指定した部分の具体値 | 同左 |
| on(ref).satisfies(name, predicate) | 提供しない | 保存した値への同期boolean条件 |
| on({ input: ref, result: ref }).satisfies(...) | 提供しない | 非空のrefレコードを同形の保存値として照合 |
| on(ref).inRange({ min, max }) | 提供しない | 数値の両端を含む範囲 |
| equal / different / lessThan | 提供しない | ref間の保存値の関係 |
| sameReference / differentReference | 提供しない | LiveRef同士のObject.is |

e.inputは束縛後の引数、e.sampleは生成データ、e.resultは結果、e.valueは固定値を表します。scenarioに単一のinputはなくsampleと返却結果を使います。定数同士・入力だけ・同一ref同士の関係を、targetの検証として受け付けません。

propertyの条件をitへ持ち込むことは型で拒否します。述語の内容やpure宣言の意味を自動証明するものではありません。述語の例外をtargetの期待した失敗に置き換えません。

## error

error.toEqual(value)、error.toBeInstanceOf(ctor)、error.message.toEqual(text)でthrow/rejectを期待します。messageはError以外に一致しません。propertyでも、生成範囲内の入力が拒否される等の性質を検証できます。

errorと正常result由来の条件は混在できません。input/sample・状態/action・境界条件は併用できます。scenarioとlawにはerrorを提供しません。準備・観測・述語・後始末の失敗や実行timeoutをtargetの期待した例外として成功にできません。

## 状態

state(token).toEqual、part(key).toEqual、unchangedを提供します。eventually({ withinMs, intervalMs })の後はtoEqualかpartだけです。どちらも正の有限値で、intervalMs <= withinMsを要求します。純粋な対象にはstateを提供しません。

propertyではstate(token)とbefore(token)をrefとして性質・関係へ渡せます。before/unchangedを使う状態は前後を読みます。状態の前後一致は、途中の出来事の不発生を意味しません。

## action

action(token).untilTargetSettles()またはforAfterTarget(ms)で区間を指定し、toEqual(events)・count(n)・none()で照合します。過去や別評価の出来事を含めず、発生時の内容を保存します。

propertyでは区間付きactionをrefとして扱えます。同じトークンに矛盾した区間を指定した場合はtarget前に拒否します。肯定条件が早く一致しても指定区間を短縮しません。

## 否定

具体値の期待に共通notはありません。不一致はpropertyの関係、不変は状態の前後、不発生はactionの有限区間で表します。観測失敗を反転して成功にしません。

## 呼び出し

effectfulなケースだけがexpectCallsでBoundaryの条件を指定できます。実効果を直接観測できない場合の代替の証拠であり、状態/actionの記述へ変換できません。境界の範囲と記録区間は[infra境界](api-mock.md)に従います。

## middlewareで生成した参照・値を検証する

観測器とBoundaryはenvironmentのscopeがその評価で発行します。ビルダーのctxから取得でき、別評価・別試行のトークンは拒否します。通常オブジェクトをctxへ入れるだけでは権限を得られません。

## コンテキスト

expectはprepare後・target前に構築します。ctxは実環境、result等はrefです。性質の述語は後から評価するため、可変のctxを期待として読み直さず、compileで不変値を確定するかvalue/input/sampleの保存値を使います。

## 期待値の保存

toEqual・部分・action全件・境界引数の期待値はcompileで独立保存します。toBeとidentity比較の生参照とは分けます。valueはcompile時、sampleは候補選択直後、inputは呼出し直前、各resultは正常完了直後に必要な値を保存します。

状態/action/sampleはSnapshotRefでidentity比較に使えません。結果レコードの合成rootもSnapshotRefです。fieldで選ぶ実際の操作結果は元の出自を保ちます。[値領域](../guides/writing-tests.md#スナップショットの値領域)に違反したコピーを成功扱いにしません。

## 深い一致と評価

値と型を保持し、文字列化した見た目だけで一致と判定しません。部分検証ではキー経路を明示します。取得不能・条件不一致・述語例外・未評価は区別して報告します。

propertyの診断には生成例/縮小候補の入力、失敗条件、再現情報を残します。法則は中間結果と比較対象を表示し、同じseedで再現できることと全入力の証明を混同しません。
