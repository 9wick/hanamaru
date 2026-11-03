# 契約からテストを書く

このページのコードが公開APIの記述契約です。許可する例と拒否する例を対で示します。対象の業務契約を別スキーマへ書き直す必要はありません。

## 対象と入口

| 対象の指定 | ケース | 入力 | 使える検証 |
|---|---|---|---|
| `target(fn)` / `target(obj, key)` | `it` / `each` | `args` / `argsFrom` / `calls` | expect・property・relate |
| `target(relation({ encode, decode }))` | `it` / `each` | `calls` | expect・property・relate |
| `target(effect(fn))` | `it` / `each` | `args` / `argsFrom` | expect・property・relate・expectCalls |
| `target(scenario({ create, rename, read }))` | `flow` | `steps` | expect・property・relate・expectCalls |

関数そのものを渡す入口とrelationは、純粋な入出力を扱います。外部状態の読み取りもeffectです。`effect(obj, key)` はthisを保持します。scenarioのメソッドもthisを必要とする場合は明示的にbindして渡します。

純粋性は対象選択の宣言であり、関数内部を自動証明する機能ではありません。純粋な入口にはenvironment・replace・expectCalls・状態/actionの検証を提供しません。単なるラベルの切り替えで型による純粋性証明が得られるとは扱いません。

## 具体値と部分

<!-- example: none — 公開APIの記述契約：具体値と禁止例 -->
```ts
import { Test, registerTest } from 'hanamaru'

const add = (a: number, b: number) => a + b
const tests = new Test().target(add)
  .it('足す', t => t.args(1, 2).expect(e => [e.result.toEqual(3)]))
registerTest(tests)

// 型エラー: 期待値はnumber。
new Test().target(add).it('型違い', t => t.args(1, 2)
  .expect(e => [e.result.toEqual('3')]))
// 型エラー: 具体値の入口にnotや任意述語はない。
new Test().target(add).it('弱い期待', t => t.args(1, 2)
  .expect(e => [e.result.not.toBe(0)]))
```

`toEqual(value)` は値の一致、`toBe(value)` はObject.isによる一致です。具体値の入口にはこの二つだけを提供します。`e.result.part('name').toEqual('Alice')` は指定した部分の検証です。partはキーを一段ずつ選び、存在しないキーを拒否します。部分の検証と全体の検証を診断でも区別します。

結果が関数なら、その関数値そのものとの同一性は期待できます。関数を期待値に渡したときに述語として実行することはありません。

## 性質

<!-- example: none — 公開APIの記述契約：性質と禁止例 -->
```ts
import { Test, registerTest } from 'hanamaru'

const sort = (values: readonly number[]) => [...values].sort((a, b) => a - b)
const sorted = new Test().target(sort)
  .it('昇順になる', t => t.args([3, 1, 2])
    .property(p => [p.on(p.result).satisfies('昇順', values =>
      values.every((value, index) => index === 0 || values[index - 1] <= value))]))
registerTest(sorted)

// 型エラー: propertyの条件をexpectへ返せない。
new Test().target(sort).it('混同', t => t.args([2, 1])
  .expect(e => [e.on(e.result).satisfies('昇順', () => true)]))
// 型エラー: 性質の述語は同期boolean。Promiseを返せない。
new Test().target(sort).it('非同期述語', t => t.args([2, 1])
  .property(p => [p.on(p.result).satisfies('昇順', async () => true)]))
```

propertyは名前付きの性質を明示します。`p.on(ref).satisfies(name, predicate)` のrefは入力・結果・状態・actionのいずれかです。述語へ渡す値の型はrefから推論します。標準条件は `p.on(ref).inRange({ min, max })`（数値・両端含む）を提供します。任意述語は性質の拡張口であり、具体値の期待を置く場所では使えません。

述語は値を読むだけとし、操作・IOを行いません。任意のクロージャがこれを守ることや、恒真条件でないことまで型で証明しません。APIは対象参照と用途を保持し、意味の妥当性はレビュー対象です。

生成入力には `t.forAll(source, { seed: 7, runs: 100 })` を使い、args / argsFrom / callsとは併用できません。pureな単一関数のitだけで使用でき、propertyまたはrelateを必須とします。effect・relation・scenarioへの入力生成は提供しません。

<!-- example: none — 公開APIの記述契約：生成入力 -->
```ts
import { Test, integers, tuples, registerTest } from 'hanamaru'

const clamp = (value: number) => Math.max(0, Math.min(10, value))
const tests = new Test().target(clamp)
  .it('範囲内になる', t => t
    .forAll(tuples(integers({ min: -100, max: 100 })), { seed: 7, runs: 100 })
    .property(p => [p.on(p.result).inRange({ min: 0, max: 10 })]))
registerTest(tests)
```

integersは両端を含む安全な整数、tuplesは対象の引数タプルを作ります。seedは安全な整数、runsは正の安全な整数を要求します。sourceは利用者が実装できる生成器ではなく、これらの構成子で作るブランド付きの記述子です。空の範囲・引数型の不整合を拒否し、暗黙の入力除外はしません。失敗時はseed・試行番号・引数を残します。縮小はこの入口の保証に含めず、得た引数をargsへコピーして再現できます。

## 関係

<!-- example: none — 公開APIの記述契約：往復関係 -->
```ts
import { Test, relation, registerTest } from 'hanamaru'

const encode = (value: string) => new TextEncoder().encode(value)
const decode = (value: Uint8Array) => new TextDecoder().decode(value)
const input = 'こんにちは'
const tests = new Test().target(relation({ encode, decode }))
  .it('元へ戻る', t => t.calls(c => c.decode.args(c.encode.args(input)))
    .relate(r => [r.equal(r.result, r.value(input))]))
registerTest(tests)
```

`relate` は `equal`（深い値の一致）、`different`（その不一致）、`sameReference` / `differentReference`（Object.isによる同一性）、`lessThan`（数値）を提供します。引数は型が対応するrefです。値の比較にはLiveRefとSnapshotRefの両方を使えますが、sameReference / differentReferenceはLiveRefだけを受け取ります。input・result・valueはLiveRef、state・before・actionはコピー済みのSnapshotRefです。fieldによる部分の参照も出自を保ちます。比較の少なくとも一方はそのケースの実行・観測に由来するrefを必要とし、定数同士や同一ref同士の比較を拒否します。異なる実行refが偶然同じ実測値になることは許します。

単一呼び出しでは `r.input(0)` が引数、`r.result` が結果です。calls / stepsで名前付きレコードを返せば `r.result.field('first')` のように選べます。calls / stepsには一意な入力タプルがないためinputは提供せず、必要な固定入力はvalueで記述します。refは実測値ではなく、通常の比較演算子へ渡せません。

<!-- example: none — 公開APIの記述契約：結果同士の不一致と禁止例 -->
```ts
import { Test, registerTest } from 'hanamaru'

const key = (a: string, b: string) => JSON.stringify([a, b])
const tests = new Test().target(key)
  .it('二組を区別する', t => t.calls(c => ({
    first: c.args('ab', 'c'), second: c.args('a', 'bc'),
  })).relate(r => [r.different(r.result.field('first'), r.result.field('second'))]))
registerTest(tests)

// 型エラー: 宣言していない関数を呼ぶ入口はない。
new Test().target(key).it('対象外', t => t.calls(c => c.call(Math.random)))
// 型エラー: relateに素のbooleanを返せない。
new Test().target(key).it('自己比較', t => t.args('a', 'b').relate(() => [true]))
```

## 値の取得時点と参照同一性

LiveRefは生の参照を保持できる出自を表し、値の比較が後から可変参照を読むという意味ではありません。検証方法に応じて、生の参照と検証用の保存値を分けます。

| refの出自 | 値として保存する時点 | 生の参照を保持する時点 |
|---|---|---|
| value(constant) | compile時 | compile時 |
| input(index) | targetを呼ぶ直前 | 同じ時点 |
| 単一targetのresult | targetがsettleし正常結果を得た直後 | 同じ時点 |
| calls / stepsの各結果 | 各呼び出しがsettleした直後、後続を始める前 | 同じ時点 |
| state / before | 指定した読み取り直後 | 保持しない |
| action | 環境が発生時に保存し、finish後に検査してコピー | 保持しない |

値を使うexpectのtoEqual・property・equal/different/lessThanは、この時点の保存値を読みます。toBe・sameReference/differentReferenceだけが、取得時点に確定した生の参照を読みます。field/partの経路もその時点で解決し、後でプロパティをたどり直しません。

保存するのは条件が必要とする値・部分だけです。例えばencodeのUint8Arrayをdecodeへ渡すだけなら、値の検証用にコピーする必要はありません。calls/stepsの引数へ渡すのは実際の戻り値であり、検証用のコピーへ置き換えません。

結果レコードの値比較は、各結果が得られた時点の保存値から組み立てます。後続操作が先行readの生のオブジェクトを書き換えても、先行readの検証値は変わりません。必要な値がスナップショット領域外ならその取得段階で失敗し、calls/stepsの後続を停止します。既に開始したaction等はtargetのsettle後の規則に従って観測・解放し、取得不能な値を条件成立にはしません。

## 環境と観測

environmentは各試行を囲む環境の定義です。第2引数のscopeだけがstate・action・boundaryを発行できます。これらの構成子はトップレベルへexportしません。環境は信頼する拡張境界であり、その提供者が読み取りや接続先の妥当性に責任を持ちます。

次の例のアプリケーションはMapへ保存し、購読口を持つローカルのメールボックスへ配達します。これがこの小さなアプリの実際の状態・効果であり、保存関数・配送関数の呼び出し記録ではありません。

<!-- example: none — 公開APIの記述契約：環境から観測までの完結例 -->
```ts
import { Test, effect, environment, registerTest } from 'hanamaru'

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
const users = new Test().target(effect(registerUser)).use(local)
  .it('保存する', t => t.argsFrom(c => [c.db, c.mailbox, c.input])
    .expect(e => [e.state(e.ctx.saved).toEqual(e.ctx.input)]))
  .it('メールが届く', t => t.argsFrom(c => [c.db, c.mailbox, c.input])
    .expect(e => [e.action(e.ctx.delivered).untilTargetSettles()
      .toEqual([{ to: e.ctx.input.email, body: 'Welcome Alice' }])]))
registerTest(users)

// 型エラー: pureなtargetにはenvironmentを登録できない。
new Test().target((n: number) => n + 1).use(local)
// 型エラー: actionの代わりに通常のオブジェクトを渡せない。
new Test().target(effect(registerUser)).use(local)
  .it('偽の観測', t => t.argsFrom(c => [c.db, c.mailbox, c.input])
    .expect(e => [e.action({ events: [] }).untilTargetSettles().none()]))
```

stateのreadは同期値またはPromiseを返せます。実行器は読み取り直後に[スナップショットの値領域](#スナップショットの値領域)を検査し、独立したコピーを保存します。期待値は照合時ではなく、compile時に同じ規則で保存します。参照同一性に使うtoBeとLiveRefは、この値の保存とは区別します。

保存の例のinputはenvironmentで試行ごとに作ります。targetが誤って `input.name = 'Wrong'` としてから保存した場合、compileで保存した期待値のAliceは変わらず、状態のtoEqualは失敗します。ケース間にもその変更を持ち越しません。

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
registerTest(new Test().target(effect(deliverThenChange)).use(local)
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
import { Test, effect, environment, registerTest } from 'hanamaru'

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
registerTest(new Test().target(effect(corrupt)).use(local)
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
// action内容の一部分だけを検証する場合も、何を見るかを明示する。
.property(p => {
  const expectedEmail = p.ctx.input.email
  return [p.on(p.action(p.ctx.delivered).untilTargetSettles())
    .satisfies('宛先', mails => mails.every(mail => mail.to === expectedEmail))]
})
```

性質の述語はtarget後に評価されます。期待する宛先はビルダーのcompile時に文字列として確定し、述語から可変のctxを読み直しません。可変オブジェクトの期待は、compileで値を保存するexpectのtoEqualまたはrelateのvalueで表します。上の宛先の性質だけでは通数を約束せず、通数の契約はactionのcount等で別に指定します。

stateは `toEqual` / `part(key).toEqual` / `unchanged` を提供します。eventuallyの後はtoEqualまたはpartだけで、unchangedは使えません。withinMsとintervalMsは正の有限値、intervalMsはwithinMs以下です。取得失敗・コピー失敗・述語の例外は再試行せず失敗とします。最初の成功で待機を終えますが、その後ずっと不変である保証にはしません。

actionは区間を決めてから `toEqual(events)`（全件・順序込み）、`count(n)`、`none()` を選べます。nは0以上の安全な整数です。countは内容を検証した扱いにはしません。noneは指定区間の不発生であり、無期限の保証ではありません。

property / relateはeffect・scenarioで `state(token)`（実行後）、`before(token)`（実行前）、`action(token).untilTargetSettles()` / `.forAfterTarget(ms)` をrefとして使えます。beforeを使用したstateは前後を読みます。これらの入口にはeventuallyを提供せず、待機を必要とする状態の一致はexpectへ分けます。

<!-- example: none — 公開APIの記述契約：コピー済み観測値の参照比較を禁止 -->
```ts
// 型エラー: usersは上のeffect対象。状態の前後はSnapshotRefで、LiveRefではない。
users.it('コピーの同一性を比較しない', t => t
  .argsFrom(c => [c.db, c.mailbox, c.input])
  .relate(r => [r.differentReference(r.before(r.ctx.saved), r.state(r.ctx.saved))]))
```

## 失敗時も同じ観測を使う

<!-- example: none — 公開APIの記述契約：失敗と不発生 -->
```ts
import { Test, effect, environment, registerTest } from 'hanamaru'

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
registerTest(new Test().target(effect(register)).use(local)
  .it('拒否時は通知しない', t => t.argsFrom(c => ['invalid', c.notifications]).expect(e => [
    e.error.toBeInstanceOf(Error), e.error.message.toEqual('denied'),
    e.action(e.ctx.sent).untilTargetSettles().none(),
  ])))
```

このローカル通知サービスはinboxへの配達を実際の効果として持ち、その出来事を購読します。targetへは送信操作だけを渡し、inbox・listeners・観測履歴historyは渡しません。通知を入力検証より前へ移すバグがあれば、例外の条件が一致してもnoneが失敗します。targetが最終状態を変更しても、独立した出来事の履歴を消せる構造にはしません。

expectのerror条件はthrow/rejectを期待します。`error.toEqual(value)` はthrowされた任意値、`error.toBeInstanceOf(ctor)` と `error.message.toEqual(text)` は例外の安定した情報を照合します。messageはError以外に一致しません。error条件とresult条件・property・relateは同一ケースに混在できません。errorと状態/action/境界の呼び出し条件は組み合わせられます。

error条件がなければ正常終了を期待します。状態のみ・actionのみでも完成でき、戻り値の無意味な検証を追加する必要はありません。throw/rejectは観測の待機・照合を省略する理由にはせず、取得できる効果を引き続き確かめます。

## infra境界を代替する

<!-- example: none — 公開APIの記述契約：許可済み境界のみを代替 -->
```ts
import { Test, effect, environment, registerTest } from 'hanamaru'

type Delivery = { send(message: string): Promise<void> }
const sendNotice = (delivery: Delivery, message: string) => delivery.send(message)
const deliveryEnvironment = environment(async (_, scope, next) => {
  const inbox: string[] = []
  const delivery: Delivery = { async send(message) { inbox.push(message) } }
  const outbound = scope.boundary(delivery, 'send')
  return next({ delivery, outbound })
})
registerTest(new Test().target(effect(sendNotice)).use(deliveryEnvironment)
  .it('配送の拒否を返す', t => t
    .replace(c => c.outbound, m => m.rejects(new Error('unavailable')))
    .argsFrom(c => [c.delivery, 'hello'])
    .expect(e => [e.error.message.toEqual('unavailable')])
    .expectCalls(c => [c.boundary(c.ctx.outbound).calledOnceWith('hello')])) )

// 型エラー: caseは境界を新設できない。通常objectとkeyも渡せない。
new Test().target(effect(sendNotice)).it('任意の差し替え', t =>
  t.replace({ send() {} }, 'send', m => m.returns(undefined)))
```

scope.boundaryは環境の準備中だけ使えます。返すトークンはその環境インスタンスが作った試行に属します。対象自身やscenarioの操作関数の代替は受付時に拒否します。トークンの持ち出し・偽造・別試行での再利用も拒否します。環境提供者が不適切な内部関数を境界登録しないことは信頼境界の責務であり、関数の業務上の意味を自動判定する保証ではありません。

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
const users = new Test().target(scenario({ create, rename, read })).use(local)
  .flow('更新後を取得する', t => t.steps(s => {
    const id = s.create.args(s.ctx.db, 'u1', 'Alice')
    s.rename.args(s.ctx.db, id, 'Bob')
    return s.read.args(s.ctx.db, id)
  }).expect(e => [e.result.toEqual('Bob')]))
registerTest(users)

// 型エラー: scenarioの操作列をcallsとして実行できない。
new Test().target(scenario({ create, read })).flow('混同', t => t.calls(() => {}))
```

stepsは同期の定義コールバックであり、実行器が記述された全操作を宣言順に一度ずつawaitします。返されないrenameも実行されます。callsは結果への依存を持つ呼び出しだけを実行するため、同じ規則ではありません。

stepsは最後の結果に限らず、実行した操作のrefまたは非空の名前付きレコードを返せます。参照は先行操作の結果だけを引数に使えます。`ref.field(key)` は正常結果のプロパティ参照です。実測値による分岐・任意関数の追加・async定義コールバックは許可しません。

scenarioは全操作の正常完了を期待します。途中のthrow/rejectは失敗として後続を止め、error条件で成功にできません。失敗そのものを期待する契約は単一のeffectケースで書きます。Result型で表す業務上の失敗は正常結果として扱えます。観測は操作列全体を囲み、途中段階の状態が必要なら公開のread操作をstepsへ置き、その結果を返して照合します。

## 操作途中の値を後から変えない

<!-- example: none — 公開APIの記述契約：操作途中の観測値の保存 -->
```ts
import { Test, scenario, environment, registerTest } from 'hanamaru'

const read = (box: { value: number }) => box
const change = (box: { value: number }) => { box.value = 2 }
const local = environment(async (_, _scope, next) => next({ box: { value: 1 } }))
registerTest(new Test().target(scenario({ read, change })).use(local)
  .flow('先行readの値は1', t => t.steps(s => {
    const first = s.read.args(s.ctx.box)
    s.change.args(s.ctx.box)
    return first
  }).expect(e => [e.result.toEqual({ value: 1 })]))
  .flow('後続変更で先行readを書き換えた期待は失敗', t => t.steps(s => {
    const first = s.read.args(s.ctx.box)
    s.change.args(s.ctx.box)
    return first
  }).expect(e => [e.result.toEqual({ value: 2 })])))
// 1件目はpassed。2件目はexpected: { value: 2 }, actual: { value: 1 }でfailed。
```

同じ保存規則を `relate(r => [r.equal(r.state(r.ctx.saved), r.value(r.ctx.input))])` にも適用します。valueの入力はcompile時に保存されるため、targetがinputを書き換えて保存した場合に比較対象まで追従することはありません。
