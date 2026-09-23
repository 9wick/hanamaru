# 宣言位置と実行結果

テストを書く人に位置やIDの入力を要求せず、計画と結果から宣言位置・各試行・失敗内容を取得できます。
完全な公開型は[hanamaru.d.ts](./spec/hanamaru.d.ts)にあります。

## 宣言位置

it / only / skip / todo / eachには、宣言したテストソースの `origin: { file, line, column }` を保持します。
groupには、その親へ子を追加した位置をGroupEntry.originに保持します。結果のgroup追加箇所にも同じoriginを残します。
fileは絶対パス、行・列は1始まりです。wrapper内でitを呼んだ場合は、そのitの位置を指します。
plan/runの呼出位置では上書きしません。同じ子を複数回追加しても子の宣言位置は変えません。

対応範囲のテストソースでは必ず提供し、取得不能をnullの正常結果にはしません。
標準CLIが直接実行するNode/Bun向けソースは[対応環境](./limitations.md)の範囲です。
ライブラリ利用で事前変換したコードは、元ソースへ対応するsource mapがある場合を対応範囲とします。
位置を提供できない定義は定義エラーです。ユーザーに位置を手入力させるAPIは設けません。
target関数の実装位置と、編集・移動・改名をまたぐidentityは初版の保証に含めません。

```text
ユーザー登録
  createUser
    ✗ 保存して通知する  tests/user-cases.ts:12:4
      group: tests/users.test.ts:8:4
      call(send).calledOnceWith
        expected: 合計1回、引数 [{ id: 'u1' }]
        actual:   合計2回
          1: [{ id: 'u1' }]
          2: [{ id: 'u2' }]
```

標準CLIはcwdからの相対パスを `file:line:column` で失敗ケースの名前に添えます。
成功・skip・todoは名前を中心に表示し、位置はデータとして保持します。
入れ子のgroupの追加位置は外側から内側へ表示し、無名のgroupも省略しません。
ルートには存在しないgroup追加位置を作りません。

## 計画と結果の対応

同名・同じ位置・同じ子の複数追加を別ケースとして扱います。
結果のpathは、ルートの番号、経路上のchildrenの番号、casesの番号を並べた0始まりの配列です。
グループとテストの結果も、そのノードまでのpathを持ちます。
CLIは収集した全計画で番号を定め、filterや表示の並べ替えでも元のpathを保持します。
ライブラリのrunでは渡した計画配列を基準にします。別の計画を渡し直した後まで同じpathを保証するものではありません。

## ケースと試行

CaseResultにはname・origin・path・row・適用したconfig・durationMs・attemptsを保持します。
失敗一覧・成否・flakyは試行から求め、CaseResultに重複したフィールドを持たせません。
通常ケースのrowはnullです。eachのrow.valueはケースの最初の試行開始前、未実行なら結果作成時に診断値へ取り込みます。eachの行番号はrow.indexに残し、表示するときだけ1始まりにします。

durationMsは最初の試行開始からケース終了・中断までの実時間で、未実行なら0です。
attemptsは実行順で、attemptは1始まりです。各試行のdurationMsも準備開始から後始末終了・中断までを測ります。各試行に状態・時間・targetの終了・アサーションの評価・失敗・後始末の状態を残します。
失敗は各試行のfailuresにだけ保持します。最後に成功しても過去の試行を消しません。

### 試行の有無と未実行の理由

実行済みのケースはattemptsが非空で、notRunを持ちません。
実行していないケースはattemptsが空で、notRunにskipped / todo / cancelledのいずれかを必ず持ちます。
明示skipとonlyによる除外はskipped、未実行予定はtodo、実行前の中断はcancelledです。
空のattemptsだけで未実行の理由を推測したり、skip等を架空の試行として追加したりしません。
この組み合わせは公開型でも制約します。

実行中の試行にはnotRunを付けません。timeoutや復元・後始末の失敗はfailed、失敗がないまま外部から中断された試行はcancelledです。詳細は下記の状態表で定めます。
再試行の間で中断して次の試行を開始しなかった場合も、開始済みの試行だけを残します。ケースの成否は最後の試行から読み、runのreasonに中断を残します。
最終以外の試行はfailedです。passed / cancelledの後へ試行を追加しません。

### 表示と集約で使う規則

| 求める情報 | 元の情報 |
|---|---|
| ケースの成否・中断 | 最後の試行のstatus。試行がなければnotRun |
| flaky | 最後の試行がpassedで、それ以前にfailedの試行がある |
| 失敗一覧 | 各試行のfailuresを試行順に並べる |

例えばfailedの後にpassedがあれば、「再試行後に成功したケース」として表示します。
これらはreporterやrunの集約時に計算します。CaseResultにstatus・flaky・failuresの写しを追加せず、JSONにも出しません。
名前・位置・設定・各試行だけで、どのケースをどう実行し、どの試行がどう終わったかを確認できます。

正常終了はoutcome.kind: return、例外はthrowとして値を保持します。対象を呼んでいなければoutcomeはnullです。
Promiseの完了を観測できない中断でもnullとし、成功の戻り値を推測しません。
診断へ値を取り込むのは検証時点です。後始末で参照先が変わっても保存済みの報告は変えません。

## 失敗の構造

| kind | 保持する情報 |
|---|---|
| assertion | 条件の参照、expected、actual |
| outcome | 期待したreturn/throwと、実際の終了・値 |
| execution | 発生段階、原因。条件評価中ならその条件の参照も保持 |
| timeout | 発生段階、timeoutMs、後始末の完了状態 |

全てにphaseと人間向けmessageを保持します。messageを解析しなくても、条件・期待・観測・原因が分かります。
アサーションの参照にはsource（expect / expectCalls）、その配列内の0始まりのindex、subject、matcherを持ちます。
callにはkeyも残し、sourceとindexから計画内のオブジェクト参照へ対応できます。同名メソッドを持つ別オブジェクトを混同しません。
expectの配列は遅延するため、評価後に得た配列との対応です。呼び出し条件のindexはexpectの成功・失敗でずれません。

各条件はpassed / failed / not-evaluatedとして記録し、未評価には理由を残します。
準備に失敗してtargetを呼べない場合、既知の呼び出し条件はnot-evaluatedです。まだ構築できないexpectの条件を捏造しません。
呼び出し0回の成功と、検証していない状態を区別します。
複数条件の失敗・原因・後始末の失敗を全て残し、最後の例外で前の失敗を消しません。

### 各マッチャの期待値と観測値

以下はDiagnosticValueへ変換する前の内容です。表の関数・RegExp等も診断の構造として保持します。

| 条件 | expected | actual |
|---|---|---|
| toBe / toEqual / toMatchObject | 指定した期待値 | 検証した戻り値または例外 |
| toSatisfy | 指定した述語 | 述語へ渡した値 |
| toBeInstanceOf | 指定したコンストラクタ | 例外の値 |
| toThrow | 指定した文字列またはRegExp | 例外の値 |
| calledTimes | 指定した回数 | 合計呼び出し回数 |
| notCalled | 0 | 合計呼び出し回数 |
| calledWith | 指定した引数タプル | 全呼び出しの引数タプルの配列 |
| calledOnceWith | { count: 1, args: 指定した引数 } | { count: 合計回数, calls: 全引数タプルの配列 } |
| calledNthWith | { n: 指定した番号, args: 指定した引数 } | { count: 合計回数, args: n回目の引数、存在しなければnull } |

引数なしの呼び出しは空配列です。存在しないn回目を空配列として扱いません。
述語のthrowはexecutionの失敗に原因を残し、その条件の評価結果をfailedにします。

## 診断用の値とJSON

expected / actual / cause / outcomeの値はDiagnosticValueです。常にkindを持ち、JSONでも同じ構造を使います。
例えば数値3は `{ kind: 'number', value: 3 }`、undefinedは `{ kind: 'undefined' }` です。
pretty reporterはこの構造から普段の値の表記へ整形します。

プリミティブ、非有限数・負の0、BigInt、配列の穴、Symbol、関数、オブジェクト、参照関係を区別します。
配列・オブジェクト等には診断内のidを付け、循環・再参照はreferenceで表します。このidを利用者に入力させません。
Date・RegExp・Map・Setの内容もそれぞれのkindで保持します。DateのvalueはISO文字列、不正なDateはnullです。Errorはobjectのtypeとname/message/cause/stackのプロパティで表します。
オブジェクトの文字列キーとSymbolキーを区別し、アクセサはgetter/setterの有無として記録します。
getterや利用者のtoJSONを診断のために実行しません。
取得できない内部状態や省略した部分にはomittedと理由を残し、空の値として偽装しません。
診断は比較に使う値そのものの代わりではなく、元の実体へ復元できることも要求しません。

## group middlewareの結果

`group(middleware, child)` を使ったgroup追加箇所では、GroupResult.childrenの各要素にmiddlewareの実行結果を保持します。
通常のgroupではmiddlewareはnullです。

middleware結果にはstatus・durationMs・failures・cleanupを保持します。
setup前に実行対象がなくmiddlewareを開始しなかった場合や、外側の中断で開始しなかった場合はnot-runとして理由を残します。
setup failureではchild配下の実行対象caseをnotRun: cancelledとし、cleanup failureでは既存のchild結果を保持したままrunをfailedにして後続を中断します。
caseの通常失敗やretryではgroup middlewareを終了・再作成せず、child全体が完了してからcleanupします。

## run全体

RunResultのstatusはpassed / failed / cancelled、reasonはcompleted / timeout / interrupted / cleanup-failedです。

### 終了状態の表

case列は最後の試行またはnotRunから求める値であり、CaseResult.statusというフィールドは設けません。
表は、記載した事象以外に失敗や中断がない場合の最終結果です。通常の失敗はretryを使い切った場合を示します。
後続列は、まだ開始していない実行対象ケースの扱いです。元からskipped / todoのケースは全行でそのまま残します。

| event | AttemptResult.status | case（派生値） | RunResult.status / reason | 後続 |
|---|---|---|---|---|
| 全検証と後始末が成功 | passed | passed | passed / completed | 続行 |
| assertion不一致・期待しない例外・準備や検証の失敗 | failed | failed | failed / completed | 続行 |
| 通常の失敗後、retryで成功 | failed → passed | passed（flaky） | passed / completed（failOnFlakyならfailed） | 続行 |
| 試行のtimeout（準備・対象・検証・後始末のいずれでも） | failed | failed | failed / timeout | notRun: cancelled |
| 復元・後始末の失敗 | failed | failed | failed / cleanup-failed | notRun: cancelled |
| Ctrl+C（実行中の試行に失敗なし） | cancelled | cancelled | cancelled / interrupted | notRun: cancelled |
| 失敗を記録した試行の後始末中にCtrl+C | failed | failed | failed / interrupted | notRun: cancelled |
| 別ケースがfailed、またはfailOnFlakyに該当した後にCtrl+C | cancelled | cancelled | failed / interrupted | notRun: cancelled |
| 失敗した試行と次のretryの間でCtrl+C | 新しい試行なし。最後はfailed | failed | failed / interrupted | notRun: cancelled |
| 最初の試行の開始前にCtrl+C | 試行なし | cancelled（notRun） | cancelled / interrupted | notRun: cancelled |
| Ctrl+C後の復元・後始末で失敗 | failed | failed | failed / cleanup-failed | notRun: cancelled |
| timeout後の復元・後始末で失敗 | failed | failed | failed / timeout | notRun: cancelled |

### 状態の判定と事象が重なる場合

- 試行に失敗が一つでもあればfailedです。timeoutはkind: timeoutの失敗を記録し、cancelledにはしません。Ctrl+Cでも記録済みの失敗を取り消しません。
- 失敗のない試行を外部から中断した場合はcancelledです。passedは検証と後始末が全て成功してから確定します。完了済みの試行は後から書き換えません。
- runのreasonは、記録された事象のうちtimeout → cleanup-failed → interrupted → completedの順で決めます。例えばtimeoutとcleanup失敗が重なればreasonはtimeoutですが、両方の失敗を保持します。
- runの中断が始まった時点で、期限に達していればtimeoutも記録します。それ以降は試行の時計による新しいtimeoutを発生させず、CLIでは終了猶予を使います。猶予切れは別のtimeoutやcleanup失敗を作りません。
- 中断後はretry・次のケース・未開始の検証を開始しません。進行中の処理が戻れば復元・後始末へ進み、そこで実際に発生した失敗も記録します。
- cleanupは全ての復元・後始末が成功すればcomplete、失敗や未完了があればincompleteです。必要な後始末がない場合はcompleteです。kind: timeoutのcleanupも、結果確定時の同じ値を保持します。

runのstatusは、timeout・cleanup失敗・caseの派生値がfailed・failOnFlakyの条件に該当するケースのいずれかがあればfailedです。
それらがなくinterruptedならcancelled、通常完了ならpassedです。途中で失敗してもretryで成功したケースは、failOnFlakyを指定しない限りrunを失敗にしません。
グループ・テストは配下のfailedを優先し、次にcancelled、それ以外はpassedとします。skip/todoだけならpassedです。
failOnFlakyはrunのstatusだけへ作用し、ケースのattemptsや各階層の結果を書き換えません。
収集のtimeoutはrun開始前の読込エラーです。この表の試行timeoutとは区別し、RunResultや架空の試行を作りません。
表示と終了コードは[CLI](./cli.md)、実行順は[実行セマンティクス](./semantics.md)を参照してください。
