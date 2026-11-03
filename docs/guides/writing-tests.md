# 契約からテストを書く

このページのコードが公開APIの記述契約です。対象の特性とケースの種類を別々に選び、許可例・禁止例を対で示します。業務契約を別スキーマへ書き直す必要はありません。

## 対象と入口

```text
target：何の契約を検証するか
  pure / effectful：対象の特性（省略時pure）
    it：具体例のケース
    property：入力範囲に対する性質のケース
```

expectはケース内で期待を書く操作です。itとpropertyを、expectとpropertyの選択に置き換えません。eachは具体例を行で並べるitの省略形です。

<!-- example: none — 公開APIの記述契約：特性とケース入口 -->
```ts
import { Test, strings, tuples, idempotent, registerTest } from 'hanamaru'

const normalize = (text: string) => text.trim()
const texts = new Test().target(normalize).pure()
  .it('前後の空白を除く', t => t.args(' hello ')
    .expect(e => [e.result.toEqual('hello')]))
  .property('冪等である', p => p
    .forAll(tuples(strings()), { seed: 7, runs: 100 })
    .law(idempotent()))
registerTest(texts)
```

`target(fn)` と `target(fn).pure()` は型・動作とも同じpureな対象です。pureは入力以外の変動する状態に依存せず、入力や外部状態を変更しないという宣言です。DBの読み取り・現在時刻の取得もeffectfulです。非同期であることだけではeffectfulにしません。

`pure()` / `effectful()` の明示はtarget後・最初のケース前に一度だけです。両方の指定、同じ宣言の重複、ケース追加後の変更はできません。省略状態のpureは、最初の明示宣言としてeffectfulを選ぶことを妨げません。定義はイミュータブルなので、元の未宣言ビルダーから別の派生を作ることはできます。

environmentを使うなら、そのuseより前にeffectfulを選びます。通常のmiddlewareを使った後も、ケース追加前で明示宣言がまだなければ選べます。省略を含め、最初のケースで特性は固定されます。純粋性の宣言が正しいかを関数内部から自動判定する保証ではありません。

<!-- example: none — 公開APIの記述契約：特性の変更を禁止 -->
```ts
import { Test } from 'hanamaru'
const add = (a: number, b: number) => a + b
new Test().target(add).pure().effectful() // 型エラー: 宣言済み
new Test().target(add).pure().pure()      // 型エラー: 重複
new Test().target(add).it('足す', t => t.args(1, 2)
  .expect(e => [e.result.toEqual(3)])).effectful() // 型エラー: ケース追加後
```

## 具体値と部分

itは具体的な入力と期待を書きます。単一関数のitにはargs / argsFromとexpectを提供し、一回の対象実行を検証します。関係の検査に必要な複数実行はpropertyの法則に属し、itにcalls・forAll・任意述語はありません。

<!-- example: none — 公開APIの記述契約：具体例と禁止例 -->
```ts
import { Test, tuples, integers, registerTest } from 'hanamaru'
const add = (a: number, b: number) => a + b
const tests = new Test().target(add)
  .it('足す', t => t.args(1, 2).expect(e => [e.result.toEqual(3)]))
registerTest(tests)

new Test().target(add).it('型違い', t => t.args(1, 2)
  .expect(e => [e.result.toEqual('3')])) // 型エラー
new Test().target(add).it('弱い期待', t => t.args(1, 2)
  .expect(e => [e.result.not.toBe(0)])) // 型エラー: 汎用notはない
new Test().target(add).it('生成', t => t.forAll(tuples(integers(), integers()))) // 型エラー
new Test().target(add).it('複数実行', t => t.calls(c => c.args(1, 2))) // 型エラー
new Test().target(add).it('ケース内で変更', t => t.args(1, 2)
  .property(() => true)) // 型エラー: propertyはtarget配下のケース入口
new Test().target(add).it('性質の混入', t => t.args(1, 2)
  .expect(e => [e.on(e.result).satisfies('正', n => n > 0)])) // 型エラー
```

`toEqual(value)` は値の一致、`toBe(value)` はObject.isです。`result.part('name').toEqual('Alice')` は指定した部分だけの検証です。partは存在するキーを一段ずつ選び、全体の一致と診断を区別します。関数値を期待値に渡しても、述語として実行しません。

## 性質

propertyはtarget配下のケース入口です。名前・入力生成器・検査内容を持ち、入力の生成・反例の縮小・再現を実行器が管理します。ケースの中にpropertyやrelateを追加する操作はありません。

<!-- example: none — 公開APIの記述契約：性質のケース -->
```ts
import { Test, arrays, integers, tuples, registerTest } from 'hanamaru'
const sort = (values: readonly number[]) => [...values].sort((a, b) => a - b)
const tests = new Test().target(sort)
  .property('昇順になる', p => p
    .forAll(tuples(arrays(integers({ min: -100, max: 100 }))))
    .expect(e => [e.on(e.result).satisfies('昇順', values =>
      values.every((value, index) => index === 0 || values[index - 1] <= value))]))
registerTest(tests)

new Test().target(sort).property('具体入力へ変更', p =>
  p.args([2, 1])) // 型エラー: propertyはforAllで入力範囲を指定
new Test().target(sort).property('非同期述語', p => p
  .forAll(tuples(arrays(integers())))
  .expect(e => [e.on(e.result).satisfies('昇順', async () => true)])) // 型エラー
```

propertyのexpectは、itと同じ具体値・部分・例外条件に加え、型付きrefを使う条件を提供します。

- `e.on(ref).satisfies(name, predicate)`：取得した値についての同期booleanの条件。
- `e.on({ input: e.input(0), result: e.result }).satisfies(...)`：非空の名前付きrefレコードを、同じ形の保存値として受け取る条件。
- `e.on(ref).inRange({ min, max })`：数値の両端を含む範囲。
- `e.equal(a, b)` / `different(a, b)`：保存値の一致・不一致。
- `e.sameReference(a, b)` / `differentReference(a, b)`：生の参照のObject.is。
- `e.lessThan(a, b)`：数値の大小。

述語は読み取りだけを行います。IOや任意の関数呼び出しを自動検出する保証はなく、恒真条件でないことも型だけでは保証しません。型は対象refと用途を制限し、性質の意味はレビュー対象です。単にpropertyを選べば正しい法則になるとは扱いません。

## 入力の生成と縮小と再現

`p.forAll(source, options)` はpropertyに一度だけ指定します。sourceはtuplesで作る生成データのタプルです。単一関数ではそのまま対象の引数に対応し、必要なら `.argsFrom((ctx, sample) => [...])` で環境の資源を添えます。argsFromは生成値を対象へ束縛する操作で、propertyを固定入力へ切り替える入口ではありません。

pure/effectfulのどちらにもpropertyを提供します。effectfulでは各生成例・各縮小候補を新しいmiddleware/environmentで囲み、DB等の初期状態と観測を毎回用意します。一つの候補の内部で必要な状態の共有は保ち、候補間へ持ち越しません。

| 構成子・設定 | 契約 |
|---|---|
| integers({ min, max }) | 両端を含む安全な整数。省略時は安全な整数全域 |
| strings({ minLength, maxLength }) | Unicodeスカラー値の列。長さはコードポイント単位。省略時0〜100 |
| arrays(source, { minLength, maxLength }) | 要素生成器から作る密な配列。省略時0〜100 |
| tuples(...sources) | 入力の各要素を生成。引数なしの対象には空タプルも指定可能 |
| seed | 安全な整数。省略時に生成して結果へ残す |
| runs | 正の安全な整数。既定100 |
| maxShrinks | 0以上の安全な整数。既定1000。0なら縮小しない |

min/maxや長さの矛盾、負の長さ等は拒否します。生成器はブランド付きの構成値で、任意オブジェクトの偽造や暗黙の入力除外は受け付けません。生成範囲内の小さな値へ向かう候補を有限予算内で検査し、同じ条件の不一致または同じ予期しない終了を再現する候補だけを反例として採用します。世界で最小の反例であるとは保証しません。

結果にはseed・生成器の形式バージョン・サンプル番号・元の反例・採用した縮小経路・縮小後の入力・予算で停止したかを残します。同じ形式バージョンとseedで入力列を再現でき、縮小後の入力をitのargsやscenarioのstepsへ写して具体例として再現することもできます。

準備・compile・観測器・検証述語の例外・後始末の失敗は、契約違反の反例として縮小しません。これらはテスト環境や検証処理の失敗です。反例候補がその種の失敗を起こした場合も、その失敗を報告して探索を止めます。

## 関係

冪等性や往復関係も性質です。利用者がcallsで呼び出し順を組むのではなく、propertyに法則を指定します。

<!-- example: none — 公開APIの記述契約：複数実行を必要とする性質 -->
```ts
import { Test, relation, strings, tuples, idempotent, roundTrip, registerTest } from 'hanamaru'
const normalize = (value: string) => value.trim()
registerTest(new Test().target(normalize)
  .property('冪等', p => p.forAll(tuples(strings())).law(idempotent())))

const encode = (value: string) => new TextEncoder().encode(value)
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes)
registerTest(new Test().target(relation({ encode, decode })).pure()
  .property('往復すると元に戻る', p => p.forAll(tuples(strings()))
    .law(roundTrip('encode', 'decode'))))
```

`idempotent()` はpureな単一引数関数に限り、f(x)を一度求め、さらにf(f(x))を実行して両結果の値を比較します。正常結果を同じ引数位置へ渡せる型が必要です。roundTripの二つのキーはrelationに宣言した単一引数関数から選び、先行の正常結果が後続の引数へ適合し、最終結果と最初の入力を値比較できる型を要求します。

法則はブランド付きの構成値です。`.law(...)` はpropertyのforAll直後だけに置け、expect・expectCalls・argsFrom・stepsとの併用はできません。これら二つの法則はpure専用です。relationは純粋な関数群の法則を表す対象なので、effectful宣言・it・eachは提供しません。副作用を持つ操作間の性質はscenarioのpropertyで記述します。

独自の単一実行の性質はexpectのonで書けます。任意の関数を実行するcallsや汎用callを拡張口にはしません。複数実行を伴う新しい法則は、対象・型の条件・実行・比較・失敗診断を定めた法則構成子として追加する必要があります。

propertyのexpectでは `e.input(index)`（束縛後の対象の引数）、`e.sample(index)`（生成したデータ）、`e.result`、`e.value(constant)` を参照できます。scenarioでは一意な引数タプルがないためinputを提供せず、sampleと返却結果を使います。名前付きの結果レコードは `e.result.field('first')` で選べます。refを通常の比較演算子へ渡して実測値の代わりにはできません。

input/result/valueはLiveRef、sample/state/before/actionはコピー済みのSnapshotRefです。参照同一性はLiveRef同士だけを受け取り、fieldも出自を保ちます。結果レコードの合成rootは実際の関数の戻り値ではないためSnapshotRefとし、fieldで選んだ各操作結果はその出自を保ちます。値の関係の少なくとも一方は実行結果か観測値に由来するrefを必要とし、定数同士・入力だけ・同一ref同士の比較はcompileで拒否します。

## 値の取得時点と参照同一性

LiveRefは生の参照を保持できる出自を表し、値の比較が後から可変参照を読むという意味ではありません。検証方法に応じて、生の参照と検証用の保存値を分けます。

| refの出自 | 値として保存する時点 | 生の参照を保持する時点 |
|---|---|---|
| value(constant) | compile時 | compile時 |
| sample(index) | 候補選択直後 | 保持しない |
| input(index) | targetを呼ぶ直前 | 同じ時点 |
| 単一targetのresult | targetがsettleし正常結果を得た直後 | 同じ時点 |
| 法則 / stepsの各結果 | 各呼び出しがsettleした直後、後続を始める前 | 同じ時点 |
| state / before | 指定した読み取り直後 | 保持しない |
| action | 環境が発生時に保存し、finish後に検査してコピー | 保持しない |

値を使うexpectのtoEqual・性質の述語・equal/different/lessThanは、この時点の保存値を読みます。toBe・sameReference/differentReferenceだけが、取得時点に確定した生の参照を読みます。field/partの経路もその時点で解決し、後でプロパティをたどり直しません。

保存するのは条件が必要とする値・部分だけです。例えばencodeのUint8Arrayをdecodeへ渡すだけなら、値の検証用にコピーする必要はありません。法則/stepsの引数へ渡すのは実際の戻り値であり、検証用のコピーへ置き換えません。

結果レコードの値比較は、各結果が得られた時点の保存値から組み立てます。後続操作が先行readの生のオブジェクトを書き換えても、先行readの検証値は変わりません。必要な値がスナップショット領域外ならその取得段階で失敗し、法則/stepsの後続を停止します。既に開始したaction等はtargetのsettle後の規則に従って観測・解放し、取得不能な値を条件成立にはしません。

## 環境と観測

environmentは各評価を囲む環境の定義です。第2引数のscopeだけがstate・action・boundaryを発行できます。これらの構成子はトップレベルへexportしません。環境は信頼する拡張境界であり、その提供者が読み取りや接続先の妥当性に責任を持ちます。

次の例のアプリケーションはMapへ保存し、購読口を持つローカルのメールボックスへ配達します。これがこの小さなアプリの実際の状態・効果であり、保存関数・配送関数の呼び出し記録ではありません。

<!-- example: none — 公開APIの記述契約：環境から観測までの完結例 -->
```ts
import { Test, environment, registerTest } from 'hanamaru'

type User = { id: string; name: string; email: string }
type Mail = { to: string; body: string }
type Mailbox = {
  deliver(mail: Mail): void
  onDelivery(listener: (mail: Mail) => void): () => void
}
function createMailbox(): Mailbox {
  const inbox: Mail[] = []
  const listeners = new Set<(mail: Mail) => void>()
  return {
    deliver(mail) {
      inbox.push(structuredClone(mail))
      for (const listener of listeners) listener(mail)
    },
    onDelivery(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
}
function registerUser(db: Map<string, User>, mailbox: Mailbox, user: User): void {
  db.set(user.id, { ...user })
  mailbox.deliver({ to: user.email, body: `Welcome ${user.name}` })
}

const local = environment(async (_, scope, next) => {
  const db = new Map<string, User>()
  const mailbox = createMailbox()
  const input: User = { id: 'u1', name: 'Alice', email: 'alice@example.test' }
  const saved = scope.state({ read: () => db.get('u1') ?? null })
  const delivered = scope.action<Mail>({
    open: () => {
      const events: Mail[] = []
      const unsubscribe = mailbox.onDelivery(mail => {
        events.push(structuredClone(mail))
      })
      return {
        finish: () => { unsubscribe(); return events },
        dispose: unsubscribe,
      }
    },
  })
  return next({ db, mailbox, saved, delivered, input })
})
const users = new Test().target(registerUser).effectful().use(local)
  .it('保存する', t => t.argsFrom(c => [c.db, c.mailbox, c.input])
    .expect(e => [e.state(e.ctx.saved).toEqual(e.ctx.input)]))
  .it('メールが届く', t => t.argsFrom(c => [c.db, c.mailbox, c.input])
    .expect(e => [e.action(e.ctx.delivered).untilTargetSettles()
      .toEqual([{ to: e.ctx.input.email, body: 'Welcome Alice' }])]))
registerTest(users)

// 型エラー: pureなtargetにはenvironmentを登録できない。
new Test().target((n: number) => n + 1).use(local)
// 型エラー: actionの代わりに通常のオブジェクトを渡せない。
new Test().target(registerUser).effectful().use(local)
  .it('偽の観測', t => t.argsFrom(c => [c.db, c.mailbox, c.input])
    .expect(e => [e.action({ events: [] }).untilTargetSettles().none()]))
```

stateのreadは同期値またはPromiseを返せます。実行器は読み取り直後に[スナップショットの値領域](#スナップショットの値領域)を検査し、独立したコピーを保存します。期待値は照合時ではなく、compile時に同じ規則で保存します。参照同一性に使うtoBeとLiveRefは、この値の保存とは区別します。

保存の例のinputはenvironmentで評価ごとに作ります。targetが誤って `input.name = 'Wrong'` としてから保存した場合、compileで保存した期待値のAliceは変わらず、状態のtoEqualは失敗します。ケース間にもその変更を持ち越しません。

actionのopenはtargetより前に呼ばれ、`{ finish, dispose }`（どちらも同期またはPromise）を返します。finishは記録を閉じ、そのセッションの全出来事を配列で一度だけ返します。disposeは記録の終了・成否に関係なく資源を解放します。ネットワークの購読ならopenは購読開始をawaitし、接続障害はfinishの失敗として伝えます。出来事は発生時点の値として環境側で保存し、後から可変参照を読む記録にはしません。

`untilTargetSettles()` は記録開始からtargetのsettleまで、`forAfterTarget(ms)` は記録開始からsettle後msまでを観測します。正の有限msを指定し、条件が早く成立しても区間を短縮しません。複数条件で同じactionを使う場合は同じ区間が必要です。異なる区間を混ぜたケースはtarget開始前に拒否します。finishが返した配列は、実行器がスナップショットの値領域を検査してコピーします。任意のセッション関数が内容を偽らないことは環境提供者の責務です。

次のケースは上のMailboxとlocalを使い、配送後の元オブジェクトの変更が、到着済みのメールを変更しないことを検証します。

<!-- example: none — 公開APIの記述契約：配送時点の値を保存 -->
```ts
const deliverThenChange = (mailbox: Mailbox) => {
  const mail = { to: 'alice@example.test', body: 'hello' }
  mailbox.deliver(mail)
  mail.to = 'changed@example.test'
}
registerTest(new Test().target(deliverThenChange).effectful().use(local)
  .it('到着時の宛先を検証する', t => t.argsFrom(c => [c.mailbox])
    .expect(e => [e.action(e.ctx.delivered).untilTargetSettles()
      .toEqual([{ to: 'alice@example.test', body: 'hello' }])])) )
```

購読開始前の過去のメールはeventsへ入らず、配送コールバック内でコピーするため、finishまでの変更にも追従しません。期待をchanged@example.testにすると失敗します。

## スナップショットの値領域

値として保存できるのはnull・undefined・boolean・string・number（NaN/Infinity/-0を保持）・bigintと、それらからなる密な通常配列・通常のプレーンオブジェクトです。DateはDate.prototypeを持つ組込みDateだけを許し、時刻値をコピーします。その他の独自prototype、null prototype、関数、symbol、accessor、非列挙プロパティ、配列の追加プロパティ、循環は拒否します。共有参照は値として複製でき、その同一性は保証しません。Proxy等の値の読み取りを偽装する仕組みは観測器の信頼境界の外です。

この規則はstateのread、actionのイベント、toEqual・partのtoEqual・action全件一致の期待値、境界呼び出しの値比較に共通です。独自クラスをstructuredCloneできたことだけで受理しません。型から関数メンバー等が分かる値は定義できず、prototype等は実際の取得時にも検査します。任意Tを受けてコピー後も同じクラス型であると偽る型は提供しません。

実資源や独自クラスを観測したい場合は、readまたは環境側のイベント収集で必要なデータへ明示的に投影します。State/Actionの型はその投影後の戻り値から推論します。MapやSetなら内容を配列・プレーンデータへ変換して観測します。生の戻り値の参照そのものを検証したい場合は、コピーしないresult.toBeまたはLiveRef同士の参照比較を使います。

<!-- example: none — 公開APIの記述契約：期待値の固定とクラス観測の禁止例 -->
```ts
import { Test, environment, registerTest } from 'hanamaru'

// 契約違反の実装。この例はfailedになるべき負例。
function corrupt(input: { name: string }, saved: { name: string }): void {
  input.name = 'Wrong'
  saved.name = input.name
}
const local = environment(async (_, scope, next) => {
  const input = { name: 'Alice' }
  const saved = { name: '' }
  const observed = scope.state({ read: () => saved })
  return next({ input, saved, observed })
})
registerTest(new Test().target(corrupt).effectful().use(local)
  .it('入力変更で期待値を変えない', t => t.argsFrom(c => [c.input, c.saved])
    .expect(e => [e.state(e.ctx.observed).toEqual(e.ctx.input)])))
// expected: { name: 'Alice' }, actual: { name: 'Wrong' }

class UserRecord { name = 'Alice'; label() { return this.name } }
const invalid = environment(async (_, scope, next) => {
  // 型エラー: メソッドを持つクラスをスナップショット型として使えない。
  const observed = scope.state({ read: () => new UserRecord() })
  return next({ observed })
})
// 正しい観測は read: () => ({ name: record.name }) のように投影する。
```

期待値の保存失敗はcompileの失敗でtargetを開始しません。実測値の取得・保存失敗は観測失敗であり、不一致や不在とは区別します。条件の意味を変える自動的なJSON化・フィールド省略・参照共有へのフォールバックは行いません。

## 状態・actionの書き分け

以下の断片は上のusersに追加するケースの期待部分です。

<!-- example: none — 公開APIの記述契約：観測の条件 -->
```ts
// 状態の前後の一致。readをtarget前後に呼ぶ。
.expect(e => [e.state(e.ctx.saved).unchanged()])
// settle後から期限内に一致するまでreadだけを繰り返す。
.expect(e => [e.state(e.ctx.saved)
  .eventually({ withinMs: 500, intervalMs: 10 }).toEqual(e.ctx.input)])
// settle後100msまで観測し、今回のメールが一件もないことを確認する。
.expect(e => [e.action(e.ctx.delivered).forAfterTarget(100).none()])

```

次の例は上のusersの登録に代えて、propertyを追加した定義を登録します。生成した名前と保存された名前の関係を検証します。入力や観測値は取得時点に保存され、targetの変更に比較対象まで追従しません。

<!-- example: none — 公開APIの記述契約：effectfulなproperty -->
```ts
import { strings, tuples } from 'hanamaru'
registerTest(users.property('どの名前も保存される', p => p
  .forAll(tuples(strings({ minLength: 1, maxLength: 12 })), { seed: 3, runs: 50 })
  .argsFrom((ctx, [name]) => [ctx.db, ctx.mailbox, { ...ctx.input, name }])
  .expect(e => [e.on({ saved: e.state(e.ctx.saved), input: e.input(2) })
    .satisfies('名前を保持する', ({ saved, input }) => saved?.name === input.name)])))
```

environmentは各生成例・各縮小候補で作り直します。述語から可変のctxを読み直すのではなく、expectビルダー内で不変の値へ確定するか、input/valueの保存値を使います。

stateは `toEqual` / `part(key).toEqual` / `unchanged` を提供します。eventuallyの後はtoEqualまたはpartだけで、unchangedは使えません。withinMsとintervalMsは正の有限値、intervalMsはwithinMs以下です。取得失敗・コピー失敗・述語の例外は再試行せず失敗とします。最初の成功で待機を終えますが、その後ずっと不変である保証にはしません。

actionは区間を決めてから `toEqual(events)`（全件・順序込み）、`count(n)`、`none()` を選べます。nは0以上の安全な整数です。countは内容を検証した扱いにはしません。noneは指定区間の不発生であり、無期限の保証ではありません。

propertyのexpectはeffectfulな対象で `state(token)`（実行後）、`before(token)`（実行前）、`action(token).untilTargetSettles()` / `.forAfterTarget(ms)` をrefとして使えます。beforeを使用したstateは前後を読みます。eventuallyを指定した状態ビルダーはrefには変換できません。待機が必要な一致は同じexpect配列に独立したtoEqual条件として書きます。

<!-- example: none — 公開APIの記述契約：コピー済み観測値の参照比較を禁止 -->
```ts
// 型エラー: コピー済み状態はLiveRefではなく、identity比較へ渡せない。
users.property('コピーの同一性を比較しない', p => p
  .forAll(tuples(strings()))
  .argsFrom((ctx, [name]) => [ctx.db, ctx.mailbox, { ...ctx.input, name }])
  .expect(e => [e.differentReference(e.before(e.ctx.saved), e.state(e.ctx.saved))]))
```

## 失敗時も同じ観測を使う

<!-- example: none — 公開APIの記述契約：失敗と不発生 -->
```ts
import { Test, environment, registerTest } from 'hanamaru'

type Notifications = { send(message: string): void }
function register(value: string, notifications: Notifications): void {
  if (value === 'invalid') throw new Error('denied')
  notifications.send(`registered: ${value}`)
}
const local = environment(async (_, scope, next) => {
  const inbox: string[] = []
  const listeners = new Set<(message: string) => void>()
  const notifications: Notifications = {
    send(message) {
      inbox.push(message)
      for (const listener of listeners) listener(message)
    },
  }
  const sent = scope.action<string>({
    open: () => {
      const history: string[] = []
      const record = (message: string) => { history.push(message) }
      listeners.add(record)
      return {
        finish: () => { listeners.delete(record); return history },
        dispose: () => { listeners.delete(record) },
      }
    },
  })
  return next({ sent, notifications })
})
registerTest(new Test().target(register).effectful().use(local)
  .it('拒否時は通知しない', t => t.argsFrom(c => ['invalid', c.notifications]).expect(e => [
    e.error.toBeInstanceOf(Error), e.error.message.toEqual('denied'),
    e.action(e.ctx.sent).untilTargetSettles().none(),
  ])))
```

このローカル通知サービスはinboxへの配達を実際の効果として持ち、その出来事を購読します。targetへは送信操作だけを渡し、inbox・listeners・観測履歴historyは渡しません。通知を入力検証より前へ移すバグがあれば、例外の条件が一致してもnoneが失敗します。targetが最終状態を変更しても、独立した出来事の履歴を消せる構造にはしません。

expectのerror条件はthrow/rejectを期待します。`error.toEqual(value)` はthrowされた任意値、`error.toBeInstanceOf(ctor)` と `error.message.toEqual(text)` は例外の安定した情報を照合します。messageはError以外に一致しません。error条件とresultを参照する条件は同一ケースに混在できません。propertyでも失敗の性質を検証できますが、errorと正常結果の参照は混在させられません。errorと状態/action/境界の呼び出し条件は組み合わせられます。

error条件がなければ正常終了を期待します。状態のみ・actionのみでも完成でき、戻り値の無意味な検証を追加する必要はありません。throw/rejectは観測の待機・照合を省略する理由にはせず、取得できる効果を引き続き確かめます。

## infra境界を代替する

<!-- example: none — 公開APIの記述契約：許可済み境界のみを代替 -->
```ts
import { Test, environment, registerTest } from 'hanamaru'

type Delivery = { send(message: string): Promise<void> }
const sendNotice = (delivery: Delivery, message: string) => delivery.send(message)
const deliveryEnvironment = environment(async (_, scope, next) => {
  const inbox: string[] = []
  const delivery: Delivery = { async send(message) { inbox.push(message) } }
  const outbound = scope.boundary(delivery, 'send')
  return next({ delivery, outbound })
})
registerTest(new Test().target(sendNotice).effectful().use(deliveryEnvironment)
  .it('配送の拒否を返す', t => t
    .replace(c => c.outbound, m => m.rejects(new Error('unavailable')))
    .argsFrom(c => [c.delivery, 'hello'])
    .expect(e => [e.error.message.toEqual('unavailable')])
    .expectCalls(c => [c.boundary(c.ctx.outbound).calledOnceWith('hello')])) )

// 型エラー: caseは境界を新設できない。通常objectとkeyも渡せない。
new Test().target(sendNotice).effectful().it('任意の差し替え', t =>
  t.replace({ send() {} }, 'send', m => m.returns(undefined)))
```

scope.boundaryは環境の準備中だけ使えます。返すトークンはその環境インスタンスが作った評価に属します。対象自身やscenarioの操作関数の代替は受付時に拒否します。トークンの持ち出し・偽造・別評価・別試行での再利用も拒否します。環境提供者が不適切な内部関数を境界登録しないことは信頼境界の責務であり、関数の業務上の意味を自動判定する保証ではありません。

replaceはケースにのみ置け、境界の型に対応した `returns` / `resolves` / `throws` / `rejects` を選びます。`returnsOnce` / `resolvesOnce` / `throwsOnce` / `rejectsOnce` の列には最後の通常動作を必須とします。任意関数を渡すcallsFakeはありません。expectCallsは `boundary(token)` から `calledTimes` / `calledWith` / `calledOnceWith` / `calledNthWith` / `notCalled` を選びます。置換しない本物の境界も記録できます。

## 操作列

<!-- example: none — 公開APIの記述契約：操作列と禁止例 -->
```ts
import { Test, scenario, environment, registerTest } from 'hanamaru'

const create = (db: Map<string, string>, id: string, name: string) => {
  db.set(id, name)
  return id
}
const rename = (db: Map<string, string>, id: string, name: string) => { db.set(id, name) }
const read = (db: Map<string, string>, id: string) => db.get(id) ?? null
const local = environment(async (_, _scope, next) => next({ db: new Map<string, string>() }))
const users = new Test().target(scenario({ create, rename, read })).effectful().use(local)
  .it('更新後を取得する', t => t.steps(s => {
    const id = s.create.args(s.ctx.db, 'u1', 'Alice')
    s.rename.args(s.ctx.db, id, 'Bob')
    return s.read.args(s.ctx.db, id)
  }).expect(e => [e.result.toEqual('Bob')]))
registerTest(users)

// 型エラー: scenarioの操作列をcallsとして実行できない。
new Test().target(scenario({ create, read })).it('混同', t => t.calls(() => {}))
```

stepsは同期の定義コールバックであり、実行器が記述された全操作を宣言順に一度ずつawaitします。返されないrenameも実行されます。stepsはscenario専用です。単一関数のitやpropertyへ自由な複数呼び出しを追加する入口にはしません。

stepsは最後の結果に限らず、実行した操作のrefまたは非空の名前付きレコードを返せます。参照は先行操作の結果だけを引数に使えます。`ref.field(key)` は正常結果のプロパティ参照です。実測値による分岐・任意関数の追加・async定義コールバックは許可しません。

scenarioは全操作の正常完了を期待します。途中のthrow/rejectは失敗として後続を止め、error条件で成功にできません。失敗そのものを期待する契約は単一のeffectfulなit/propertyで書きます。Result型で表す業務上の失敗は正常結果として扱えます。観測は操作列全体を囲み、途中段階の状態が必要なら公開のread操作をstepsへ置き、その結果を返して照合します。

同じ対象集合で、生成した名前についての性質も書けます。次の例は上のusersの登録に代えるものです。

<!-- example: none — 公開APIの記述契約：操作列のproperty -->
```ts
import { strings, tuples } from 'hanamaru'
registerTest(users.property('作成した名前を取得できる', p => p
  .forAll(tuples(strings({ minLength: 1, maxLength: 12 })))
  .steps(s => {
    const id = s.create.args(s.ctx.db, 'u1', s.input[0])
    return s.read.args(s.ctx.db, id)
  })
  .expect(e => [e.equal(e.result, e.sample(0))])))
```

ここでs.inputは生成タプルのデータであり、e.sampleはその保存値へのrefです。各候補ごとにlocalのDBを作り直し、作成と取得の間では同じDBを使います。

## 操作途中の値を後から変えない

<!-- example: none — 公開APIの記述契約：操作途中の観測値の保存 -->
```ts
import { Test, scenario, environment, registerTest } from 'hanamaru'

const read = (box: { value: number }) => box
const change = (box: { value: number }) => { box.value = 2 }
const local = environment(async (_, _scope, next) => next({ box: { value: 1 } }))
registerTest(new Test().target(scenario({ read, change })).effectful().use(local)
  .it('先行readの値は1', t => t.steps(s => {
    const first = s.read.args(s.ctx.box)
    s.change.args(s.ctx.box)
    return first
  }).expect(e => [e.result.toEqual({ value: 1 })]))
  .it('後続変更で先行readを書き換えた期待は失敗', t => t.steps(s => {
    const first = s.read.args(s.ctx.box)
    s.change.args(s.ctx.box)
    return first
  }).expect(e => [e.result.toEqual({ value: 2 })])))
// 1件目はpassed。2件目はexpected: { value: 2 }, actual: { value: 1 }でfailed。
```

同じ保存規則をpropertyのexpect内の `e.equal(e.state(e.ctx.saved), e.value(e.ctx.input))` にも適用します。valueの入力はcompile時に保存されるため、targetがinputを書き換えて保存した場合に比較対象まで追従することはありません。
