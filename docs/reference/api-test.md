# Test ビルダー

対象、対象の特性、ケースの種類を順に選びます。[完結したコード例と禁止例](../guides/writing-tests.md)が公開構文の契約です。

## 定義の段階

targetを指定して共通設定を作り、it/propertyを追加します。最初のケース以降は対象・特性・共通設定を変更できません。groupを追加したチェーンにはtargetやケースを追加できません。

## テスト対象を指定する: target

target(fn)、target(obj, key)で単一関数・メソッドを固定します。キーの形式はthisを保持します。先頭に表示名を付けられますが、IDやソース位置の入力は要求しません。

relation({ encode, decode })はpureな変換の集合を法則で検証する対象です。scenario({ create, rename, read })は公開操作の集合を一つのケースで実行する対象です。単一targetを自由なcallsへ置き換える入口はありません。

## pure / effectful

省略時はpureで、pure()の明示と型・動作が一致します。pureは入力以外の変動状態に依存せず、入力や外部を変更しないという約束です。外部の読み取りもeffectfulであり、非同期だけではeffectfulにしません。

明示はtarget後、最初のケース前に一度だけです。pure().effectful()やpure().pure()、ケース後の変更を拒否します。environmentを使う場合はuseより前にeffectfulを指定します。関数の中身から特性を推測・証明する機能ではありません。

relationはpureだけを受け付けます。単一targetとscenarioは両特性に対応します。effect(fn)というラッパーは使いません。

## it / property

it(name, body)は具体例、property(name, body)は入力範囲に対する性質のケースです。どちらも対象に固定した専用ビルダーをbodyへ渡します。propertyはitの中の検証操作ではありません。

単一targetのitは一回の引数と具体的な期待を書きます。propertyはforAllで生成方法を決め、expectまたはlawで検査します。冪等性などの複数実行は法則の検査が行います。

scenarioのitは具体的な操作列、propertyは生成値から作る操作列をstepsへ記述します。flowという第三のケース入口は設けません。relationはpropertyのlawだけを受け付けます。

## it / only / skip / todo

only/skipは単一targetとscenarioのitと同じ引数・具体例ビルダーです。todoは名前だけで未実行を表します。property専用のonly/skip/todo記法は提供せず、CLIの選択を利用します。

## use

middlewareは全対象に使え、値を準備してnextから供給します。environmentはeffectfulだけで、scopeが状態・action・infra境界の評価トークンを発行します。propertyでは生成例・縮小候補ごとに囲み直します。

## group

完成した子とmiddleware・実行設定を合成します。高価な資源は共有できますが、propertyの候補間やケース間の状態依存は許しません。environmentやreplaceをgroupへ直接置けません。[グループ](../guides/grouping.md)に従います。

## mock

任意object/keyのmockはありません。effectfulなケースだけがreplaceで、environmentの許可済みBoundaryを代替できます。propertyでも同じ制限です。[infra境界](api-mock.md)に従います。

## timeout / retry

共通設定はケース追加前、個別設定は入力/生成/操作の指定前に置きます。propertyの試行期限は生成と縮小の全評価を含みます。観測の待機とは区別します。[実行設定](../guides/execution-options.md)に従います。

## each

単一targetのitを行で並べる入口です。rowから型を推論し、各行に完成した具体例を要求します。each内でpropertyやforAllへ切り替えることはできません。[each](../guides/each.md)に従います。

## blueprint（プラグイン向け）

[blueprint](metadata.md)は対象の形、特性、ケースkind、入力または生成・法則、観測と期待のビルダーを保持します。取得しても環境やtargetは実行しません。
