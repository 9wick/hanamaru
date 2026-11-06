# Test ビルダー

target、特性、ケース種類を分けます。[具体的な書き方](../guides/writing-tests.md)が公開構文です。

## 定義の段階

対象と共通設定を決め、it/propertyを追加します。最初のケース以降は対象・特性・共通設定を変更できません。groupは完成した子を合成し、自身にtargetやケースを持ちません。

## テスト対象を指定する: target

target(fn)は関数、target(obj, key)は固定した受け手のメソッドです。target(Class, key)はクラスとメソッド名で責任を固定し、from(ctx => instance)を必須にします。クラス形式は静的メソッド指定とは混同せず、静的関数はtarget(Class.staticMethod)で渡します。

fromはuseによる供給後・ケース前に一度指定し、評価のprepare後に受け手を解決します。instanceof Class、呼出し可能なデータプロパティを検査します。継承instanceやinstance上の関数フィールドを許し、prototypeの関数参照との一致は要求しません。未供給・別クラスを拒否します。getter経由はreceiverの解決だけで別のコードが走ることを避けるため拒否します。固定されるのはクラスと公開操作名までで、instanceが提供するメソッド本体の同一性は保証しません。環境で対象メソッドをstubにすることは契約検証として不適切ですが、任意のJavaScript介入の隔離は行いません。

scenario({ optimized, reference })で対象集合を固定できます。インスタンスを後から供給するメソッドは `method(Class, 'name')` を要素にし、scenarioのfromでそのキーだけのinstanceマップを渡します。例えば `.target(scenario({ create: method(Users, 'create'), update: method(Users, 'update') })).effectful().use(local).from(c => ({ create: c.users, update: c.users }))` です。関数だけのscenarioにfromはありません。

## pure / effectful

省略時pureと明示pureは同じ意味です。入力以外の変動状態に依存せず、入力や外部を変更しないと宣言します。外部の読み取りもeffectfulで、非同期だけではeffectfulにしません。

明示はtarget後・ケース前に一度だけです。重複・切替・ケース後の指定を拒否します。effectfulを選んでからenvironmentをuseします。関数の中身や宣言の正しさを自動証明しません。

## it / property

単一targetはitとpropertyを持ちます。itは一回の具体入力、propertyはforAllで指定する入力範囲について検査します。expectは各ケースの期待です。

scenarioはpure/effectfulのどちらでも、具体的な操作列のitと、生成値を使う操作列のpropertyを持ちます。itでは具体値・部分・許容誤差とeffectfulなら状態/actionを期待し、任意述語や結果間の性質条件を提供しません。複数回であること自体を性質と判定しません。

## use

middlewareは全対象の準備に使え、effectfulな対象にはenvironmentも使えます。environmentが評価固有の観測トークンと、依存・fake・制御口をnextで供給します。実装への任意の差し替え権限をケースへ渡す操作はありません。

## group

完成した子とmiddleware・実行設定を合成します。共有資源の寿命と評価固有の初期状態を分けます。environmentは子のuseに置き、groupで観測トークンを共有しません。[グループ](../guides/grouping.md)に従います。

## mock

mock/replace/expectCallsは提供しません。引数に応じるfakeと入力側の時計・乱数等の制御は環境へ置き、観測のevidenceで効果と呼び出し記録を区別します。[環境の代替](api-mock.md)に従います。

## it / only / skip / todo

only/skipは提供されるitと同じ具体例ビルダーです。todoは名前だけの未実行宣言です。property専用のonly/skip/todo記法は設けず、CLIの選択を使います。

## each

単一targetのitを行で並べます。各行に具体入力と完成した期待を要求し、forAllやstepsへの切替はできません。

## timeout / retry

共通設定はケース追加前、個別設定は入力・生成・操作の指定前です。propertyの一試行は生成と縮小の全評価を含みます。[実行設定](../guides/execution-options.md)に従います。

## blueprint（プラグイン向け）

対象の形・特性・ケース種類・受け手resolver・入力・観測・期待を保持します。取得しても環境や対象を実行しません。[blueprint](metadata.md)に従います。
