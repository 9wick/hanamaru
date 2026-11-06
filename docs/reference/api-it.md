# ケースの記述

itとpropertyはtarget配下の並列のケース入口です。property/relateをit内へ追加するAPIはありません。[公開構文](../guides/writing-tests.md)に従います。

## args / argsFrom

単一targetのitはargsまたはargsFrom(ctx => tuple)で具体的な一回の引数を指定します。引数なしにもargs()を要求します。

単一targetのpropertyはforAllのタプルを直接使うか、argsFrom((ctx, sample) => tuple)で依存やデータを束縛します。複数実行が必要ならargsFromの代わりにstepsを選びます。クラスの依存はtargetのfromへ供給でき、データ引数へ移す必要はありません。

## propertyとforAll

propertyはforAllを一度指定し、その入力範囲に対するexpectを必要とします。標準の単一実行、またはstepsによる対象限定の操作列を検査できます。空の生成範囲を拒否しますが、一点の範囲や空タプルは許します。探索範囲の広さを自動で保証しません。

## steps

単一targetのpropertyではs.target.args、scenarioではsの宣言キーを使えます。scenarioではpure/effectfulを問わずit/propertyに提供します。単一targetのitには提供しません。

s.ctxは準備済み環境、propertyのs.inputはcompile時点で確定した具体的な生成タプルです。s.inputは読み取り・計算・分岐に使えますが、操作結果のrefはまだ実測値ではありません。同期コールバックで全操作を記述し、結果refまたは非空の結果レコードを返します。全操作を宣言順にawaitします。実測値による分岐・任意関数を渡すcall・asyncな定義は拒否します。

## 期待と観測

itは具体値・部分・許容誤差・状態/actionの条件（例外は単一実行または明示的な最終操作のみ）、propertyはそれらに加えon(refs).satisfiesを使えます。expectは一度だけ、非空の完成条件配列を返します。状態/actionだけでも完成できます。

複数実行の法則はstepsとexpectで表せます。専用relation/lawの閉じた集合を実装者が追加しないと新しい性質を書けない設計にはしません。

## errorと明示的な最終操作

errorは単一実行と、finalで指定した明示的な最終操作の終了を検証します。stepsの前段はargsで正常完了を要求し、最終操作だけfinal(...args)にできます。FinalStepRefは一つだけ、直接または平坦な結果レコードの一フィールドとして返します。

error/outcomeの指定がなければfinalも正常終了を期待します。最終の制約はcompileで検査し、後続操作・複数final・返されないfinalを拒否します。FinalStepRefは次の操作の引数にはできません。it/propertyのどちらでも最後のerrorを期待でき、propertyならoutcomeでreturn/throwを一つの性質として扱えます。

最後の正常結果とそのerror/outcomeは混在できません。先行操作の成功結果は併用できます。前段の例外は失敗として後続を止め、最後に期待した例外には流用しません。finalなしのstepsは全操作の正常完了を要求します。Result型の失敗値は通常の結果です。

## 環境

case内のmock/replaceはありません。useするenvironmentの設定や型付きfakeが外部条件を作ります。対象自身の実装を変えるためのフレームワークの差し替え口は提供しません。

## timeout / retry

入力/forAll/stepsより前に指定します。retryは全ケース、eventuallyは状態の読み取りだけの再試行です。

## 結果の期待を組み立てる時点

各評価のprepare後、from・argsFrom・steps・expectをcompileします。実環境とrefを区別し、結果依存の観測は実行後に引数を解決します。ビルダーのthrowはtargetの例外ではありません。
