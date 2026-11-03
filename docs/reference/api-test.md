# Test ビルダー

Testは対象と用途に応じて次の操作を絞ります。全ての具体例・禁止例は[契約からテストを書く](../guides/writing-tests.md)に定めます。

## 定義の段階

対象・共通設定を決め、ケースを追加します。最初のケース以降は対象と共通設定を変更できません。groupを追加したチェーンにはtargetやケースを追加できません。

## テスト対象を指定する: target

| 指定 | 意味 | ケース入口 |
|---|---|---|
| target(fn)、target(obj, key) | 純粋な関数・メソッド | it / each |
| target(effect(fn))、target(effect(obj, key)) | 外部状態を読む、または変える関数・メソッド | it / each |
| target(relation({ encode, decode })) | 純粋な関数群の関係 | it / each |
| target(scenario({ create, rename, read })) | 順序を持つ公開操作の集合 | flow |

先頭に表示名を付けられます。対象は一度だけ指定し、型は実際の関数から推論します。effectはアプリ関数を変更せず、テストの対象宣言にだけ付けます。オブジェクトとキーの形式はthisを束縛します。

## use

middlewareは全種類、environmentはeffect/scenarioだけが受け付けます。環境を使う場合はtargetを先に指定します。environmentのscopeが発行するState・Action・Boundaryトークンをnextでケースへ渡します。[環境の完結例](../guides/writing-tests.md#環境と観測)を参照してください。

## group

完成した子を合成し、middleware・timeout・retryの範囲を定めます。environmentやreplaceをgroupへ置くことはできません。高価な資源はgroup middleware、試行トークンは子のenvironmentで扱います。[グループ](../guides/grouping.md)に従います。

## mock

任意object/keyを受け取るmockはありません。ケース内の `replace(ctx => ctx.boundary, behavior)` により、環境が許可した境界だけを代替できます。[infra境界](api-mock.md)に従います。

## timeout / retry

共通設定はケース追加前、個別設定はケースの入力・操作の確定前に指定します。[実行設定](../guides/execution-options.md)に従います。

## it / only / skip / todo

itは名前と完成ケースを返すコールバックを受け取ります。only / skipはitと同じ形で選択だけを変えます。todoは名前だけを受け取り未実行を表します。scenarioはflowで定義し、この版ではflow専用のonly/skip/todoは提供しません。CLIの選択は使用できます。

## each

対象の型とrowからケースを推論します。各行は独立した完成ケースです。each内にはforAllを提供しません。[each](../guides/each.md)に従います。

## blueprint（プラグイン向け）

完成した定義から[blueprint](metadata.md)を取得できます。対象kind・入力kind・検証ビルダー・許可済み境界の代替を保持し、定義時に環境・targetを実行しません。
