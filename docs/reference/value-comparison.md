# 値の比較と保存

具体値を指定できる対象を、コピー処理の都合でプレーンデータだけに制限しません。toEqualのための比較表現と、propertyの述語へ渡す型付きデータを分けます。

## 構造等価

toEqualはプリミティブをObject.isで、配列とオブジェクトを型・prototype・データの構造で比較します。Mapは順序によらないキー/値の組、Setは順序によらない要素、TypedArrayはコンストラクタと要素、ArrayBufferはバイト列、Dateは時刻値を比較します。MapのキーやSet要素も構造で照合し、一対一に対応させます。

通常のクラスはprototypeの同一性と公開ownデータを比較します。関数・symbolは同一性で扱い、関数を呼んで比較しません。循環は参照対を追跡して比較します。欠けた値とundefined、配列の穴と要素undefinedは区別します。共有参照であること自体は値の一致に要求せず、必要ならtoBeで同一性を検証します。

Errorはprototype・name・message・cause・独自データを比較し、stackは等価性へ含めません。getterを暗黙に呼んで全体比較しません。accessorは記述子のgetter/setterの同一性として扱います。partで明示的に選んだgetterだけは取得時点で呼び、失敗なら観測失敗とします。

private fieldやネイティブな外部資源など、公開構造では意味のある状態を取得できない値を、空のオブジェクト同士として一致させません。opaque-valueとして診断し、必要なら次の値アダプターを明示します。

## 不透明な値のアダプター

値アダプターは一つの型の値表現を定める、任意の拡張です。業務上の責任を別スキーマへ定義する仕組みではありません。標準のデータや公開データを持つクラスには不要です。

<!-- example: none — 公開APIの記述契約：privateな値の比較 -->
```ts
import { Test, valueAdapter, registerTest } from 'hanamaru'
class Money {
  #minor: number
  constructor(minor: number) { this.#minor = minor }
  minorUnits(): number { return this.#minor }
}
const moneyValue = valueAdapter(Money, value => ({ minor: value.minorUnits() }))
const price = () => new Money(120)
registerTest(new Test().target(price)
  .it('価格', t => t.args().expect(e => [e.result.toEqual(new Money(120), moneyValue)])))
```

capture関数は期待値にはcompile時、実測値には取得時点で適用し、返されたデータを保存して比較します。元のMoneyを複製したと偽りません。adapterの対象型と入力型を検査し、失敗・不正な返り値を握り潰しません。型の意味を正しく表すcaptureかは提供者の責任で、恒真なアダプターを自動で検出する保証はありません。診断には使った型と投影した値を残します。

## 保存のタイミング

| 値 | 保存時点 |
|---|---|
| toEqual等の期待値・value | compile |
| 生成sample | 候補選択直後 |
| 対象のinput | 呼出し直前 |
| 各操作のresult | 正常完了直後、次の操作より前 |
| 型を絞った例外のfield/project | 終了期待の対象（単一targetまたは明示的な最終操作）のthrow/reject後、ofTypeの検査成功直後 |
| outcome.withErrorのpayload | return値は正常完了直後、throw値は型検査後にprojectErrorを適用して保存 |
| state | 指定した読取時点 |
| action | 発生時点。finish後にも比較表現を確定 |

比較表現は実際のオブジェクトとは独立した値グラフです。prototypeと関数のidentityは参照を保持しますが、比較するownデータやネイティブ値は保存します。targetが入力や期待値の元参照を書き換えても、その保存値を更新しません。

対象の次の操作へ渡す値は本物の戻り値で、比較用表現へ置き換えません。取得不能を成功や空値へ変換せず、必要な結果の保存失敗なら後続操作を止め、取得可能な効果の観測と後始末を行います。

## 述語へ渡すデータ

propertyのonは、プリミティブ・通常配列・プレーンオブジェクトと、Date/Map/Set/TypedArray/ArrayBuffer等の型を保ってコピーできるデータを受け取ります。内側の値も同じ条件です。循環は保持できます。独自prototypeやprivate fieldを持つ値は、元の型のまま述語へ渡せるコピーとは見なしません。

必要ならpropertyで `e.project(e.result, money => ({ minor: money.minorUnits() }))` のようにデータへ投影し、そのrefをonへ渡します。projectの返り値型を推論し、射影は元refの取得時点で一度実行します。任意述語や射影関数の意味は信頼する拡張境界であり、実装の責任を置き換えてよいという意味ではありません。

参照の同一性はpropertyの `e.identity(ref)` で得るIdentityRefをonへ渡してObject.is等で検査できます。対象のinput/result/valueだけに提供し、コピーしたstate/action/sampleやproject済みデータにidentityを適用することは型・compileで拒否します。IdentityRefの型は同一性比較用のopaque objectで、元のオブジェクトのプロパティを読み直せません。これで値の比較と同一性の観測を混同しません。

## 数値の許容誤差

toBeCloseTo(expected, { absoluteTolerance })はitにもpropertyにも使えます。abs(actual - expected) <= absoluteToleranceで照合し、期待値・許容誤差・実測値を表示します。どれも有限、許容誤差は0以上を要求します。任意述語へ退避しなくても、近似値という具体的な期待を指定できます。
