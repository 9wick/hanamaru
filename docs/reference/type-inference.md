# 型推論

対象・環境・選んだ検証方法から型を推論します。公開構文と負例は[契約からテストを書く](../guides/writing-tests.md)に定めます。

## 対象とコンテキスト

| 指定 | 決まる型・操作 |
|---|---|
| target(fn) / target(obj, key) | pure。ParametersとAwaited ReturnType。it / each / args / calls |
| target(effect(fn)) | effect。ParametersとAwaited ReturnType。it / each / args。environmentと境界の代替を許可 |
| target(relation(functions)) | pure-relation。関数名ごとの呼び出しと戻り値。callsのみ |
| target(scenario(functions)) | scenario。操作名ごとの引数と結果。flow / stepsのみ |
| use(middleware(...)) | next(fields)の型をコンテキストへ追加 |
| use(environment(...)) | effect / scenarioのみ。値とState・Action・Boundaryトークンの型を追加 |

環境を付ける前にtargetの種類を決めます。middlewareは全種類で使えますが、scopeを受け取らず観測器や境界を発行できません。pureな対象にenvironmentのある共通設定を引き継がせる合成も型エラーです。

## middlewareから型を伝える

next(fields)の型を後続へ伝えます。フィールドはreadonly、同名は内側が置換します。資源の参照を浅く渡すことと、状態観測の値をコピーすることは別です。

middlewareとenvironmentはnextを一度呼び、その完了値を返します。素の関数・通常オブジェクトを完了値として返すことは型エラーです。nextの回数・待機・試行後の呼び出しは実行時にも検査します。

## 設定とケース追加を分ける

共通設定は最初のケース・groupの前に固定します。targetを再指定できません。ケースではreplace・timeout・retryを入力/操作の確定前に指定し、入力/操作後に戻れません。

| ケースの段階 | 許される記述 | 完成したケースとして返せるか |
|---|---|---|
| pure単一・入力前 | args / argsFrom / calls / forAll、実行設定 | 不可 |
| pure-relation・操作前 | calls、実行設定 | 不可 |
| effect・入力前 | args / argsFrom、replace、実行設定 | 不可 |
| scenario・操作前 | steps、replace、実行設定 | 不可 |
| 入力/操作済み、検証なし | 用途に合うexpect / property / relate / expectCalls | 不可 |
| 有効な検証あり | 未指定の検証入口を追加 | 可 |
| forAllで具体値expectのみ | property / relateを追加 | 不可 |
| forAllでpropertyまたはrelateあり | 未指定の検証入口を追加 | 可 |

expect / property / relate / expectCallsはそれぞれ一度だけ指定でき、コールバックは空でない条件配列を返します。組合せの順序は任意です。入力なしの関数にもargs()を必要とします。

## 完成条件

| 対象 | 完成に使える条件 | 禁止する条件・組合せ |
|---|---|---|
| pure単一 | 結果の一致・部分、例外、性質、関係 | 状態/action/境界。errorとresult/property/relateの混在 |
| pure-relation / calls | 結果の一致・部分、性質、関係 | error、状態/action/境界 |
| effect | 結果・例外・状態・action・性質・関係・境界呼び出し | errorとresult/property/relateの混在 |
| scenario | 結果・状態・action・性質・関係・境界呼び出し | error、任意関数の追加、非同期steps |

状態のみ・actionのみ・境界呼び出しのみでも完成できます。error条件がないケースは正常終了を期待します。errorと状態/action/境界呼び出しは組み合わせられます。error条件がないことを「結果を検証した」と診断することはありません。

完了していないactionの区間指定や、eventuallyの設定だけでは条件になりません。toEqual等の終端操作が必要です。todoは別の未実行定義で、検証済みの成功にしません。

## グループとコンテキスト

独立した子だけが `new Test<R>()` で必要なコンテキストを要求します。親が供給する値とそのタイミングを合成時に照合します。子のgroup前処理で必要な値を、後から動くattemptのmiddlewareで供給することはできません。

group middlewareは資源を共有できますが、試行のトークンを生成しません。environmentは各effect/scenarioのuseで各試行に適用します。groupへenvironmentを渡すこと、試行で生成したトークンを親groupや別試行へ保存して使うことは許可しません。

## 参照と記述子の型

State<T>、Action<E>、Boundary<F>、ValueRef<T>（LiveRefまたはSnapshotRef）と条件の各型はブランドで区別し、利用者がオブジェクトリテラルから作れないようにします。

expectは具体値・部分・例外・状態/action条件、propertyはPropertyCondition、relateはRelationCondition、expectCallsはBoundaryCallConditionだけを受け取ります。素のbooleanや別用途の条件は受け取りません。同期booleanを要求する述語はPromiseを返せません。

ValueRef.field(key)、入力の位置、境界の引数は元の型から検査します。input/result/value由来のLiveRefと、state/before/action由来のSnapshotRefを区別し、fieldも出自を保ちます。LiveRefにも値比較用の保存値があり、照合時に生の可変値を読み直すことはありません。sameReference / differentReferenceはLiveRefしか受け取れず、コピー済みの観測値を渡すことは型・compileの両方で拒否します。StateとActionの取り違え、境界トークンの代わりにobject/keyを渡す操作を拒否します。異なる試行の同じ型のトークン・refを混ぜたことは、所有者の実行時検査でも拒否します。TypeScriptが全インスタンスの同一性を判定できるとはしません。

State/Actionと値比較の期待値は[スナップショットの値領域](../guides/writing-tests.md#スナップショットの値領域)に制限します。関数メンバー等の静的に禁止できる値は拒否し、独自prototype・accessor等は取得時にも検査します。観測器がデータへ投影した場合はその返り値型を使い、コピーで失われるクラスのメソッド型を保持しません。

## 型の限界

pure宣言が真であること、述語が恒真でないこと、観測器やinfra境界の業務的な妥当性は自動証明しません。これは信頼する環境提供者とレビューの責務です。

数値の範囲、refの所有者・循環・同一性、action区間の矛盾、状態のコピー可能性、観測の失敗は実行受付または試行の対応段階で検査します。型を回避した不正を未評価や成功へ置き換えません。

## 検証

[公開構文の許可例・禁止例](../guides/writing-tests.md)を型と実行の受け入れ条件にします。例の成功だけでなく、用途外の操作が補完に現れず型エラーになることを確認します。実行時の所有者・期間・観測障害は[実行セマンティクス](../concepts/semantics.md)に従って検証します。

## each・実行設定・sequence

eachは行からrowを推論し、その対象の種類に合う完成ケースを要求します。forAllはpure単一のitだけに提供します。境界のonce列には通常動作が必要です。timeout・retryは入力/操作の確定前に指定します。
