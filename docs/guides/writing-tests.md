# 契約からテストを書く

targetで対象、pure/effectfulで特性、it/propertyでケースの種類を選びます。expectはケース内の期待です。このページのコードと禁止例を公開構文の契約とします。

## 対象と入口

<!-- example: none — 公開APIの記述契約：具体例と性質 -->
```ts
import { Test, strings, tuples, registerTest } from 'hanamaru'
const normalize = (text: string) => text.trim()
registerTest(new Test().target(normalize).pure()
  .it('空白を除く', t => t.args(' hello ').expect(e => [e.result.toEqual('hello')]))
  .property('冪等である', p => p.forAll(tuples(strings())).steps(s => {
    const first = s.target.args(s.input[0])
    return { first, second: s.target.args(first) }
  }).expect(e => [e.on({ first: e.result.field('first'), second: e.result.field('second') })
    .satisfies('二度適用しても同じ', ({ first, second }) => first === second)])))
```

省略時pureは明示pureと型・動作が同じです。pureは入力以外の変動状態に依存せず、入力や外部を変えないという宣言です。外部の読み取りもeffectfulで、非同期だけではeffectfulにしません。内部の純粋性を自動証明する機能ではありません。

pure()/effectful()の明示はtarget後・最初のケース前に一度だけです。重複、両方の指定、ケース後の切替を拒否します。environmentはeffectfulを選んだ後にだけuseできます。イミュータブルな未宣言ビルダーから別の派生を作ることはできます。

<!-- example: none — 公開APIの記述契約：用途外の記述を拒否 -->
```ts
import { Test, integers, tuples } from 'hanamaru'
const add = (a: number, b: number) => a + b
new Test().target(add).pure().effectful() // 型エラー: 明示済み
new Test().target(add).pure().pure() // 型エラー: 重複
new Test().target(add).it('足す', t => t.args(1, 2)
  .expect(e => [e.result.toEqual(3)])).effectful() // 型エラー: ケース追加後
new Test().target(add).it('生成', t => t.forAll(tuples(integers(), integers()))) // 型エラー
new Test().target(add).it('繰り返す', t => t.steps(s => s.target.args(1, 2))) // 型エラー
new Test().target(add).it('任意条件', t => t.args(1, 2)
  .expect(e => [e.on(e.result).satisfies('正', n => n > 0)])) // 型エラー
```

## 具体値と部分

単一targetのitはargsまたはargsFromで一回の入力を指定します。argsの値は定義で受け取った参照をそのまま渡し、対象へ渡す値は自動複製しません。入力の同一性の契約を保つためです。入力を変更する対象や再試行で新しいオブジェクトが必要なら、argsFromで評価ごとに作ります。期待値の比較用保存はこれとは別です。具体値はtoEqual、参照はtoBe、数値の許容誤差はtoBeCloseTo(expected, { absoluteTolerance })を使います。許容誤差は有限の0以上で、期待・実測も有限の数値を要求します。共通notや任意述語はありません。

part(key)で部分を明示できます。プロパティがgetterなら、明示したその部分の取得時にだけ読みます。取得失敗を不在と混同しません。部分の検証を出力全体の一致として報告しません。

<!-- example: none — 公開APIの記述契約：標準の値をそのまま比較 -->
```ts
import { Test, registerTest } from 'hanamaru'
const encode = (text: string) => new TextEncoder().encode(text)
registerTest(new Test().target(encode)
  .it('Aを符号化する', t => t.args('A')
    .expect(e => [e.result.toEqual(new Uint8Array([65]))])))
const ratio = (a: number, b: number) => a / b
registerTest(new Test().target(ratio)
  .it('3分の1', t => t.args(1, 3)
    .expect(e => [e.result.toBeCloseTo(0.333333, { absoluteTolerance: 0.000001 })])))
```

toEqualはMap/Set/TypedArray/Dateと通常のクラスの公開データも比較できます。比較のためにアプリの戻り値をプレーンオブジェクトへ変更させません。期待値は実行前に独立した比較表現へ保存します。[値の比較](../reference/value-comparison.md)に規則があります。

## 性質

propertyはforAllで入力範囲を指定し、expectで性質を表します。単一targetは生成タプルを引数にして一度実行します。資源を添える場合はargsFrom((ctx, sample) => tuple)、複数実行が必要ならstepsを選びます。両方の併用はできません。

<!-- example: none — 公開APIの記述契約：可換性 -->
```ts
import { Test, integers, tuples, registerTest } from 'hanamaru'
const add = (a: number, b: number) => a + b
registerTest(new Test().target(add)
  .property('可換である', p => p
    .forAll(tuples(integers({ min: -100, max: 100 }), integers({ min: -100, max: 100 })))
    .steps(s => ({ ab: s.target.args(s.input[0], s.input[1]), ba: s.target.args(s.input[1], s.input[0]) }))
    .expect(e => [e.on({ ab: e.result.field('ab'), ba: e.result.field('ba') })
      .satisfies('順序を入れ替えても同じ', ({ ab, ba }) => ab === ba)])))
```

onにはrefまたは非空の名前付きrefレコードを渡します。satisfiesは名前と同期booleanの述語を受け取り、必要な保存値が揃ってから評価します。関係もこの性質の表現で扱い、equal/different/lessThan/inRange等の別系列の条件APIを増やしません。refそのものを通常の演算子に渡せません。

任意述語の意味や、恒真条件でないことは自動証明しません。propertyを選ぶこと自体が正しい性質の証明にはなりません。空タプルや一点の範囲も正当な入力領域なので許しますが、診断には探索した範囲と件数を示し、広い範囲を検証したとは扱いません。

固定入力について性質を確かめる場合はconstantを使います。空の生成タプルにargsFromで入力を隠す必要はありません。

<!-- example: none — 公開APIの記述契約：固定入力の性質 -->
```ts
import { Test, constant, tuples, registerTest } from 'hanamaru'
const sort = (values: readonly number[]) => [...values].sort((a, b) => a - b)
registerTest(new Test().target(sort)
  .property('回帰入力も昇順になる', p => p.forAll(tuples(constant([3, 1, 2])))
    .expect(e => [e.on(e.result).satisfies('昇順', values =>
      values.every((value, index) => index === 0 || values[index - 1] <= value))])))
```

失敗の内容も入力に対する性質として書けます。propertyでは型を絞った例外のfieldをrefとして使い、通常のonで比較します。

<!-- example: none — 公開APIの記述契約：例外と生成入力の関係 -->
```ts
import { Test, strings, tuples, registerTest } from 'hanamaru'
class TooLong extends Error {
  constructor(readonly length: number) { super('too long') }
}
const acceptShort = (text: string) => {
  if (text.length > 8) throw new TooLong(text.length)
  return text
}
registerTest(new Test().target(acceptShort)
  .property('拒否した入力の長さを返す', p => p
    .forAll(tuples(strings({ minLength: 9, maxLength: 20 })))
    .expect(e => [e.on({ actual: e.error.ofType(TooLong).field('length'), input: e.input(0) })
      .satisfies('lengthを保持する', ({ actual, input }) => actual === input.length)])))
// 型エラー: Errorへ絞っただけではlengthフィールドは指定できない。
new Test().target(acceptShort).property('型が不足', p => p
  .forAll(tuples(strings({ minLength: 9, maxLength: 20 })))
  .expect(e => [e.on(e.error.ofType(Error).field('length')).satisfies('長さ', n => n > 8)]))
```

例外refを含むexpectはthrow/rejectを期待します。同じ終了対象の正常resultとの混在を型とcompileで拒否し、指定した例外型と違う場合は型条件の不一致として失敗します。クラス全体を述語へ渡す場合は、通常の結果と同じ保存規則に従いprojectで必要なデータへ投影できます。

## 成功と失敗が混在する性質

単一実行のpropertyにはoutcome refを提供します。入力範囲を成功と失敗に分割したり、targetをtry/catchで包み直したりせず、両方の契約を一つの述語で検査できます。

<!-- example: none — 公開APIの記述契約：正常と例外が混在する入力範囲 -->
```ts
import { Test, strings, tuples, registerTest } from 'hanamaru'
class TooLong extends Error {
  constructor(readonly length: number) { super('too long') }
}
const acceptShort = (text: string) => {
  if (text.length > 8) throw new TooLong(text.length)
  return text
}
registerTest(new Test().target(acceptShort)
  .property('長さに応じて受理または拒否する', p => p.forAll(tuples(strings({ maxLength: 20 })))
    .expect(e => [e.on({ input: e.input(0),
      outcome: e.outcome.withError(TooLong, error => ({ length: error.length })) })
      .satisfies('終了と内容', ({ input, outcome }) => input.length <= 8
        ? outcome.kind === 'return' && outcome.value === input
        : outcome.kind === 'throw' && outcome.error.length === input.length)])))
```

outcomeはreturn/throwの判別unionです。withError(Ctor, projectError)はthrowした場合だけ型を検査し、元の例外から必要なデータを保存します。正常終了も許し、正常側のvalueは対象の戻り値型です。projectErrorを省略すると例外側のerrorはnullで、型の一致だけを要求します。例えばパーサのoutcome.withError(ParseError)なら、成功する入力とParseErrorだけで失敗する入力の両方を許せます。

指定と違う例外型は条件不一致として失敗し、射影や述語を呼びません。射影の失敗は観測障害です。outcomeを使うケースは同じ終了対象の正常resultやerror専用の条件/refを併用できません。input/sample依存の観測や前後状態は併用できます。outcomeは単一実行のpropertyと、明示的な最終操作を返すpropertyのstepsで使えます。it・観測引数には提供しません。

生のoutcomeの型は `{ kind: 'return'; value: R } | { kind: 'throw'; error: unknown }` です。例外を勝手な型のコピーへ変換せず、onへ内容を渡す場合はwithErrorかprojectを使います。終了種別だけならoutcome.field('kind')をonへ渡せます。これらの保存規則は[値の比較](../reference/value-comparison.md)に従います。

上のacceptShortに対し、終了種別の指定を矛盾させる書き方は拒否します。

<!-- example: none — 公開APIの記述契約：outcomeと正常結果の混在を禁止 -->
```ts
new Test().target(acceptShort).property('矛盾', p => p.forAll(tuples(strings()))
  .expect(e => [
    e.result.toEqual(''),
    e.on(e.outcome.field('kind')).satisfies('どちらも扱う', kind => kind === 'return' || kind === 'throw'),
  ])) // 型エラー: returnだけの期待とreturn-or-throwは同じケースへ混在できない。
```

## 入力の生成と縮小と再現

integers、strings、arrays、tuples、constant、boolean、record、oneOfで入力を生成します。integersは安全な整数（省略時全域）、stringsはUnicodeスカラー値の列、arraysは密な配列で、長さの既定範囲は0〜100です。範囲の両端は含みます。空の範囲・負の長さ・型不整合を拒否します。

forAll(source, { seed, runs, maxShrinks })で探索を調整できます。seedは安全な整数で省略時は生成して記録、runsは正の安全な整数で、固定入力源以外の既定は100、maxShrinksは0以上で既定1000です。普段はsourceだけを書けます。

constant(value)は型付き保存可能な値を定義時に保存し、評価ごとに独立したコピーを渡します。boolean()は真偽値、record({ key: source })は各フィールドを生成し、oneOf(...sources)は非空の選択肢から生成します。縮小もその選択肢のいずれかが表す範囲を守ります。constantだけからなるtuples/recordと空タプルは固定入力源で、runs省略時は一評価・縮小なしです。明示runsで繰り返す場合も固定入力であることを表示し、探索範囲が広いとは報告しません。

反例は生成範囲を守って縮小し、元の入力と採用した縮小後の入力を残します。最大予算までに見つけた反例であり、世界で最小とは保証しません。詳細な停止・再現規則は[結果](../reference/results.md)と[実行仕様](../concepts/semantics.md)に定めます。

## 関係

複数の対象はscenarioで宣言します。pure/effectfulを問わず、scenarioのitは具体的な操作列と具体値の期待、propertyは入力範囲に対する性質を持ちます。関係のためだけのrelationや閉じたlaw集合は設けません。標準法則を補助関数にする場合も、同じ対象限定のstepsとexpectを組み立てる省略形です。

<!-- example: none — 公開APIの記述契約：参照実装との一致 -->
```ts
import { Test, scenario, integers, tuples, registerTest } from 'hanamaru'
const optimized = (n: number) => n * 2
const reference = (n: number) => n + n
registerTest(new Test().target(scenario({ optimized, reference }))
  .property('参照実装と一致する', p => p.forAll(tuples(integers({ min: -100, max: 100 })))
    .steps(s => ({ actual: s.optimized.args(s.input[0]), expected: s.reference.args(s.input[0]) }))
    .expect(e => [e.on(e.result).satisfies('同じ値', values => values.actual === values.expected)])))
// 型エラー: scenarioでもitに任意述語は提供しない。
new Test().target(scenario({ optimized })).it('性質の混入', t => t
  .steps(s => s.optimized.args(2))
  .expect(e => [e.on(e.result).satisfies('正', n => n > 0)]))
```

## 環境と観測

対象の固定と、評価ごとのインスタンス供給は別です。クラスのメソッドはtarget(UserService, 'register')で責任を指定し、from(ctx => ctx.users)で受け手を供給します。fromは環境準備後に一度解決します。フレームワークがコンストラクタを呼ぶことはありません。

次はコンストラクタへ依存を注入し、メソッドへデータだけを渡すアプリです。テスト用のrepo/配送システムは代替環境なので、その観測のevidenceをsubstitute-effectと明示します。サービスへ渡すのは送信口だけで、受信側の観測口や記録は渡しません。

<!-- example: none — 公開APIの記述契約：DIサービスと結果依存の受信側観測 -->
```ts
import { Test, environment, registerTest } from 'hanamaru'

type Input = { name: string; email: string }
type User = Input & { id: string }
type Mail = { userId: string; to: string; body: string }
type Receipt = { receiptId: number; userId: string; recipient: string; text: string }
type Users = { save(user: User): Promise<void>; find(id: string): Promise<User | null> }
type Sender = { send(mail: Mail): Promise<void> }
class DeliveryError extends Error { readonly code = 'unavailable' }
class UserService {
  constructor(private users: Users, private sender: Sender, private nextId: () => string) {}
  async register(input: Input): Promise<User> {
    const user = { ...input, id: this.nextId() }
    await this.users.save(user)
    await this.sender.send({ userId: user.id, to: user.email, body: `Welcome ${user.name}` })
    return user
  }
}

function local(options: { rejectedAddress?: string } = {}) {
  return environment(async (_, scope, next) => {
    const rows = new Map<string, User>()
    const users: Users = {
      async save(user) { rows.set(user.id, structuredClone(user)) },
      async find(id) { return rows.get(id) ?? null },
    }
    const requests: Mail[] = []
    const inbox: Receipt[] = []
    const listeners = new Set<(receipt: Receipt) => void>()
    let receiptId = 0
    // 外部配送の代替モデル: 宛先を正規化し、受領番号を付けた配送済み状態を作る。
    const receive = (mail: Mail) => {
      const receipt = { receiptId: ++receiptId, userId: mail.userId,
        recipient: mail.to.toLowerCase(), text: mail.body }
      inbox.push(receipt)
      for (const listener of listeners) listener(receipt)
    }
    const sender: Sender = {
      async send(mail) {
        requests.push(structuredClone(mail))
        if (mail.to === options.rejectedAddress) throw new DeliveryError('delivery unavailable')
        await Promise.resolve()
        receive(mail)
      },
    }
    let id = 0
    const service = new UserService(users, sender, () => `user-${++id}`)
    const saved = scope.state({ evidence: 'substitute-effect', read: (key: string) => users.find(key) })
    const savedByEmail = scope.state({ evidence: 'substitute-effect',
      read: (email: string) => [...rows.values()].filter(user => user.email === email) })
    const received = scope.state({ evidence: 'substitute-effect',
      read: (key: string) => inbox.filter(mail => mail.userId === key) })
    const requestLog = scope.state({ evidence: 'call-record', read: () => requests })
    const deliveries = scope.action<Receipt>({ evidence: 'substitute-effect', open: () => {
      const events: Receipt[] = []
      const record = (receipt: Receipt) => { events.push(structuredClone(receipt)) }
      listeners.add(record)
      return {
        finish: () => { listeners.delete(record); return events },
        dispose: () => { listeners.delete(record) },
      }
    } })
    return next({ service, saved, savedByEmail, received, deliveries, requestLog })
  })
}
const base = new Test().target(UserService, 'register').effectful()
const input: Input = { name: 'Alice', email: 'alice@example.test' }
registerTest(base.use(local()).from(ctx => ctx.service)
  .it('採番されたユーザーが保存され、メールが届く', t => t.argsFrom(() => [{ ...input }]).expect(e => [
    e.state(e.ctx.saved, e.result.field('id')).part('name').toEqual('Alice'),
    e.state(e.ctx.received, e.result.field('id')).part(0).part('recipient').toEqual(input.email),
    e.action(e.ctx.deliveries).untilTargetSettles().count(1),
  ])))
registerTest(base.use(local({ rejectedAddress: input.email })).from(ctx => ctx.service)
  .it('配送に失敗する', t => t.argsFrom(() => [{ ...input }]).expect(e => [
    e.error.ofType(DeliveryError).part('code').toEqual('unavailable'),
    e.state(e.ctx.savedByEmail, e.input(0).field('email')).part('length').toEqual(1),
    e.action(e.ctx.deliveries).untilTargetSettles().none(),
  ])))
```

このサンプルの登録処理は、配送に失敗しても先に保存したユーザーを残す契約です。失敗時はresultのIDがないため、入力のemailで保存状態を観測しています。

targetで固定するのは宣言したクラスと公開メソッド名です。受け手と、そのinstanceが提供する実装は各評価で供給されます。クラス形式はfromを必須とし、指定クラスのinstanceと呼び出せるデータプロパティのメソッドを実行時にも検査します。継承したinstanceやinstance上の関数フィールドも扱い、prototype上の関数参照との一致は要求しません。この検査は操作の名前・受け手の型と供給時点を守るもので、メソッド本体の同一性を証明するものではありません。環境でtarget自身のメソッドをstubへ上書きすれば契約の検証にはなりませんが、そのような任意のJavaScriptの介入をsandbox化する保証はありません。別のクラス・欠けたメソッド・getterを使ったメソッド供給は、receiverを解決するだけで別の利用者コードが走ることを避けるため拒否します。

インスタンスの公開メソッドを指定する既存のtarget(obj, key)も使えます。その場合は受け手も固定で、fromは提供しません。fromはtargetの変更ではなく、宣言したクラス/メソッドの受け手の供給です。

## 状態・actionの書き分け

stateはreadの引数と戻り値から型を推論し、e.state(token, ...args)で定数またはinput/sample/resultのrefを束縛します。通常は対象計画のsettle後に読みます。結果を使う観測をscenarioの対象操作に追加する必要はありません。

propertyのstate(...).before()は実行前の値のrefで、on/projectへ渡せます。unchangedは前後の一致条件です。どちらも実行前に同じ保存した引数で読みます。結果依存の引数はまだ存在しないので、この用途には使えません。stepsの途中を観測する場合はstate(...).after(stepRef)で、その操作の完了直後・次の操作より前に読みます。引数refがその時点までに解決できない場合はcompileで拒否します。

eventuallyは読み取りだけを再試行し、targetを呼び直しません。afterとeventuallyの併用は許さず、途中観測は一度の読み取りに限ります。状態の前後一致とactionの不発生は別です。

actionはopenで記録開始、finishで区間内の履歴取得、disposeで解放します。untilTargetSettlesまたはforAfterTarget(ms)で有限の区間を定めます。観測器は発生時点のデータを保存し、targetが消せる最終配列だけを履歴にしません。

次は実際のtargetの状態について、入金前後の関係を検証する例です。

<!-- example: none — 公開APIの記述契約：前状態と後状態の性質 -->
```ts
import { Test, environment, integers, tuples, registerTest } from 'hanamaru'
class Account {
  balance = 10
  deposit(amount: number): void { this.balance += amount }
}
const accountEnvironment = environment(async (_, scope, next) => {
  const account = new Account()
  const balance = scope.state({ evidence: 'real-effect', read: () => account.balance })
  return next({ account, balance })
})
registerTest(new Test().target(Account, 'deposit').effectful().use(accountEnvironment)
  .from(ctx => ctx.account)
  .property('入金額だけ残高が増える', p => p.forAll(tuples(integers({ min: 0, max: 100 })))
    .expect(e => [e.on({ before: e.state(e.ctx.balance).before(),
      after: e.state(e.ctx.balance), amount: e.input(0) })
      .satisfies('増分', ({ before, after, amount }) => after === before + amount)])))
```

input/sample/result/state/before/afterのrefと利用可能な時点は[refの入口](../reference/type-inference.md#refの入口)に定めます。beforeだけを条件にしてtargetを検証した扱いにはしません。

## 証拠の種類

state/actionは時間的な観測の形、evidenceは観測元の宣言です。必須の値は次の三つで、プロセス内外では分類しません。

| evidence | 観測するもの |
|---|---|
| real-effect | target自身の実状態、または置換していない依存・資源で成立した状態や出来事 |
| substitute-effect | 依存の契約（状態遷移・受理・拒否等）を模したfakeが生成・保持するモデル上の状態や出来事 |
| call-record | 依存へ渡された引数・呼び出し回数・返却を記録したもの |

同じfakeでも、sendへ渡されたrequestsはcall-record、受理後にモデルが作る配送済みinboxはsubstitute-effectです。拒否時はrequestsに呼び出しが記録されても配送済みは0件です。標準の失敗ケースは保存状態と配送済みの効果（いずれもsubstitute-effect）だけを検証し、call-recordの再送回数は契約に含めていません。このモデルの適合性は環境提供者が保証し、本物の配送まで証明したとは報告しません。引数を単に保存しただけなら、受信側という名前を付けてもcall-recordです。

Recordsのsizeのように実際のtarget自身の状態を読む場合はreal-effectです。判定基準は観測元であり、同一プロセスにあることやテスト用の環境であることだけではsubstitute-effectにしません。

フレームワークは宣言の真実性を自動認証しません。evidenceは型による証拠の格付けではなく、実行結果で検証範囲を誤認させないための環境提供者による明示です。caseからの変更・欠落を拒否し、観測結果・JSON・表示に残します。

## infra境界を代替する

mock/replace/expectCallsと、Boundary・順序付きのreturnsOnce等は提供しません。環境が型付きのfakeと観測口を用意し、引数に応じた応答や外部障害を表します。上のlocal({ rejectedAddress })も入力に対応したfakeであり、内部の呼び出し順を固定していません。

時計・乱数・外部入力の固定も環境の仕事です。これらの入力制御そのものは『効果を呼び出し確認で代用した』ことではありません。出力をどこで観測したかをevidenceで区別します。ケースは選んだ環境のctxを使い、任意object/keyの差し替えAPIは持ちません。環境や任意の利用者コードの善意まで型で保証しません。

## 操作列

stepsは宣言した対象だけを実行できます。単一targetのpropertyではs.target、scenarioでは宣言キーを使います。scenarioのitでは具体値・部分・許容誤差と、effectfulなら状態/actionを期待し、任意述語や結果間の性質条件を提供しません。errorは単一実行、またはfinalで指定した最終操作に使えます。単一targetのitは一回の呼び出しに限りますが、宣言済みの対象集合に対する具体的な回帰例は許します。

scenarioはpure/effectfulのどちらでもit/propertyの両方を持ちます。純粋な具体例を書くためにeffectfulと偽る必要はありません。propertyのstepsはcompile時点で確定した具体的なsampleをs.input、環境をs.ctxで受け取り、全操作を宣言順にawaitします。返却しなかった操作も実行します。

<!-- example: none — 公開APIの記述契約：effectfulな冪等性と途中観測 -->
```ts
import { Test, environment, strings, tuples, registerTest } from 'hanamaru'
class Records {
  private rows = new Set<string>()
  upsert(key: string): void { this.rows.add(key) }
  size(): number { return this.rows.size }
}
const local = environment(async (_, scope, next) => {
  const store = new Records()
  const count = scope.state({ evidence: 'real-effect', read: () => store.size() })
  return next({ store, count })
})
registerTest(new Test().target(Records, 'upsert').effectful().use(local).from(c => c.store)
  .property('再送しても件数が増えない', p => p.forAll(tuples(strings())).steps(s => ({
    first: s.target.args(s.input[0]), second: s.target.args(s.input[0]),
  })).expect(e => [
    e.on({ first: e.state(e.ctx.count).after(e.result.field('first')),
           second: e.state(e.ctx.count).after(e.result.field('second')) })
      .satisfies('件数を保持する', ({ first, second }) => first === 1 && second === first),
  ])))
```

stepsの結果refはvoidでも操作の完了を識別できます。s.inputはrefではなく具体値なので、変更せずに計算・分岐へ使えます。一方、CallRef/FinalStepRefは未実行の記述であり、通常の計算や実測値での分岐へ使えません。対象外の関数追加・asyncな定義コールバックも拒否します。取得済み結果や途中観測の検証値は後続変更に追従しません。

## 公開操作の後の失敗を検証する

stepsの最後にだけ `s.target.final(...args)` または宣言キーの `s.register.final(...args)` を置けます。前段は通常のargsで正常終了を要求し、最後の操作だけerror（it/property）またはoutcome（property）で検証します。fakeの内部へ前提をseedする必要はありません。

<!-- example: none — 公開APIの記述契約：前段操作の後に拒否される契約 -->
```ts
import { Test, scenario, method, environment, strings, tuples, registerTest } from 'hanamaru'
class DuplicateKey extends Error {
  constructor(readonly key: string) { super('duplicate') }
}
class Registry {
  private keys = new Set<string>()
  register(key: string): string {
    if (this.keys.has(key)) throw new DuplicateKey(key)
    this.keys.add(key)
    return key
  }
  size(): number { return this.keys.size }
}
const local = environment(async (_, scope, next) => {
  const registry = new Registry()
  const size = scope.state({ evidence: 'real-effect', read: () => registry.size() })
  return next({ registry, size })
})
registerTest(new Test().target(scenario({ register: method(Registry, 'register') }))
  .effectful().use(local).from(c => ({ register: c.registry }))
  .it('同じキーの2回目は拒否する', t => t.steps(s => {
    s.register.args('a')
    return s.register.final('a')
  }).expect(e => [
    e.error.ofType(DuplicateKey).part('key').toEqual('a'),
    e.state(e.ctx.size).toEqual(1),
  ])))
registerTest(new Test().target(Registry, 'register').effectful().use(local).from(c => c.registry)
  .property('登録済みのキーを再登録できない', p => p.forAll(tuples(strings()))
    .steps(s => {
      const registered = s.target.args(s.input[0])
      return { registered, duplicate: s.target.final(s.input[0]) }
    }).expect(e => [
      e.on({ existing: e.result.field('registered'), rejected: e.error.ofType(DuplicateKey).field('key') })
        .satisfies('既存キーを通知する', ({ existing, rejected }) => existing === rejected),
      e.state(e.ctx.size).toEqual(1),
    ])))
```

上のRegistry/localを使えば、最後の入力によって受理と拒否が分かれる性質もoutcomeで検査できます。

<!-- example: none — 公開APIの記述契約：明示的な最終操作のoutcome -->
```ts
import { boolean } from 'hanamaru'
registerTest(new Test().target(Registry, 'register').effectful().use(local).from(c => c.registry)
  .property('既存キーだけ拒否する', p => p.forAll(tuples(strings(), boolean())).steps(s => {
    s.target.args(s.input[0])
    return s.target.final(s.input[1] ? s.input[0] : `${s.input[0]}!`)
  }).expect(e => [e.on({ key: e.sample(0), duplicate: e.sample(1),
    last: e.outcome.withError(DuplicateKey, error => ({ key: error.key })) })
    .satisfies('最終操作の契約', ({ key, duplicate, last }) => duplicate
      ? last.kind === 'throw' && last.error.key === key
      : last.kind === 'return' && last.value === `${key}!`)])))
```

finalはその評価の最後の操作として一度だけ記述します。返すFinalStepRefは通常の結果refとは区別し、次の操作の引数やfield選択に使えません。stepsからそのまま返すか、先行操作のrefと同じ平坦なレコードの一フィールドとして返します。finalを呼んだのに返さない、二つ記述する、後続操作を置く記述はcompileで拒否します。コールバック内の順序をTypeScriptだけで証明する保証はしません。

<!-- example: none — 公開APIの記述契約：最終操作finalの順序違反 -->
```ts
// 上のRegistry/localを使い、CLIに実行させるため登録する。
registerTest(new Test().target(scenario({ register: method(Registry, 'register') }))
  .effectful().use(local).from(c => ({ register: c.registry }))
  .it('finalの後へ操作を置けない', t => t.steps(s => {
    const last = s.register.final('a')
    s.register.args('later')
    return last
  }).expect(e => [e.result.toEqual('a')])))
```

この定義は型だけでは順序違反と判定せず、実行時のcompileでexecution失敗になります。targetのregisterは一度も呼ばず、期待は未評価、phaseはcompile、原因はfinalの後の操作です。環境の後始末を行います。propertyなら縮小せず探索を止めます。

finalにerror/outcomeを指定しない場合は、通常どおり正常終了を期待します。最終位置を明示して正常結果や状態だけを検証する書き方も許します。finalという名前だけでthrowを許可することはありません。

明示的な最終操作のerror/outcomeは、その最後の操作だけを指します。前段がthrowした場合は予期しない失敗で停止し、最後は未実行です。同じ例外型だったとしても、前段の失敗で最後のerror条件を満たすことはありません。

結果レコードを返した場合、e.result.field('registered')のような先行成功結果は最後のerror/outcomeと併用できます。最後の正常結果に依存するref（上のduplicateフィールドや、それを含むレコード全体）は、最後のerror/outcomeと混在できません。propertyのe.outcomeのvalueは最終操作自身の正常結果であり、返却レコード全体ではありません。

最後の後観測は定数・sample・先行成功結果に依存するものを継続します。最終操作の正常結果が必要な観測はthrow期待/outcomeとは併用できません。最後の操作後は通常のafter-plan観測を使い、after(stepRef)は先行する通常操作だけに指定します。結果の保存・参照同一性・受け手・評価の独立性の規則は変わりません。

## 値の取得時点と参照同一性

期待値とvalueはcompile時、sampleは候補選択時、inputは対象呼出し直前、resultは各操作完了直後、stateは指定時点、actionは発生時点で必要な値を保持します。生の値を次の操作へ渡すことと、検証用の比較表現を保存することを区別します。

propertyのonへ渡すのは、型を保って独立保存できるデータです。独自クラスのメソッドを偽のコピー上で呼ばせません。必要ならpropertyのe.project(ref, value => data)で公開のデータへ投影してからonへ渡します。具体例のtoEqualにはこのデータ限定を適用しません。[値の比較](../reference/value-comparison.md)を参照してください。

## スナップショットの値領域

toEqualの比較表現と、述語へ渡す型付きデータを区別します。Map/Set/TypedArrayやクラスを比較できることと、任意クラスをメソッドごと複製できることは同じではありません。細部は[値の比較と保存](../reference/value-comparison.md)に定めます。

## 同じ操作を繰り返す具体例

同じupsertを二回行い件数が1という具体的な回帰例は、`target(scenario({ upsert: method(Records, 'upsert') })).effectful()` のitで書きます。fromで同じstoreを供給し、steps内で宣言したupsertを二回実行してstateの件数をtoEqual(1)で確認します。入力範囲について冪等性を検査する場合は、上の単一targetのpropertyを使います。回数ではなく、具体的な期待か性質かで入口を選びます。
