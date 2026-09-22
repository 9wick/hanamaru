# 実行セマンティクス

このページは標準実行器の契約です。run(plan)の同一プロセス実行と、CLIによる期限超過時の停止を区別します。
ランナーは未実装であり、ここに記載する実行時保証は実装・検証対象です。

## 定義と実行の境界

`new Test()` のチェーンは、it・each・mock・expectCallsの定義コールバックを評価して計画を組み立てます。
expectのコールバックは保存し、この時点では呼びません。
`.plan()` は計画を取得し、`run()` が実行します。
setup・use・target・argsFrom・fake・述語は、計画取得だけでは呼びません。
定義中はメソッドを差し替えず、呼び出しの記録も開始しません。
テストモジュールのトップレベルコードは通常のimportと同様に動きます。

expectCallsが返す空配列・不正な記述子や定義コールバックのthrowは定義エラーです。
実行時に返るexpectの不正な配列やthrowは、そのケースの失敗です。
eachは行順でケースに展開します。空の行配列、不正なtimeout/retry/nth、宣言位置の取得不能も定義エラーです。

## 計画の受付

```ts
const result = await run(tests.plan())
const results = await run([first.plan(), second.plan()])
```

単一計画または計画配列を受け取ります。初版の標準実行器は渡された順、children順の深さ優先、ケースの宣言順で直列実行します。
ただしこの順序は利用者が依存できるテストの意味ではありません。各caseは他のcaseの実行有無・実行順に依存せず、将来のshuffle・並列実行・複数processへの配置で順序が変わっても同じ意味を持つものとします。
同じ子を複数箇所に合成しても参照で重複排除せず、それぞれの経路の設定で実行します。

結果のtestsはルート計画と同じ順・同じ件数です。
グループの結果はchildren、テストの結果はcasesを持ち、それぞれ計画と同じ階層・順・件数です。
skip/todoも結果に残すため、名前がなくても、重複していても配列の位置で対応します。

version・計画構造・呼び出し条件の妥当性を階層全体について実行前に検査します。
循環、空のchildren/cases、不正なsteps・mock・config・origin・sequenceの終端動作等も受付エラーです。同じ子を別の経路から参照することは循環ではありません。
空の計画配列や、同じhost runtimeでactiveなrunがある間のrunの重複実行は受付エラーです。先のrunをawaitして完了した後に次のrunを開始することはできます。
受付エラーではsetup・useを開始せずPromiseをrejectします。ケース中の失敗は結果に残します。通常はretryの規則に従ってそのケースを完了し、他のケースを続けます。
timeout・外部中断・復元や後始末の失敗では後続を中断します。

## Runとprocess

実行モデルではRunが一つ以上のexecution processを所有します。

```text
Run
  Process 1
  Process 2
  ...
```

processは必ず一つのRunに属し、Runをまたいで実行状態を共有する単位にはしません。
初版のライブラリ `run(plan)` は一つのprocessで実行できます。標準CLIは停止保証等のために実行環境をprocessとして分離でき、将来は一つのRunへ複数processを配置できます。
process数やcaseの配置はrunnerの実行戦略であり、caseの意味に含めません。

RunのPromiseは、そのRunが所有する開始済みのexecution processと必要な後始末が完了してからsettleします。
同じhost runtimeではactiveなRunを一つに制限しますが、完了したRunの後に別のRunを開始できます。

## group middleware

`group(middleware, child)` のmiddlewareは、そのgroup追加箇所のchild全体を一度だけ囲みます。
通常の `.use()` は各caseの各attemptで実行しますが、group middlewareはretryやcaseごとには作り直しません。

group middlewareへ渡すctxは、そのgroup定義が外側から要求する安定したctxです。
親ノードのsetup/useは各attemptで実行されるため、そこで初めて作る値をgroup middlewareのsetupに渡すことはしません。
一方、group middlewareが `next(fields)` へ渡した値は、各child attemptで親のper-attempt ctxと合成し、childのargsFrom・expectから参照できます。

実行の概略は次のとおりです。

```text
group middleware setup
  child case A
    attempt setup/use → target → assertions → cleanup
    retryがあれば次のattempt
  child case B
    attempt setup/use → target → assertions → cleanup
group middleware cleanup
```

setupが失敗した場合はchildのcaseを開始しません。cleanupが失敗した場合はrunを失敗として後続を中断します。
共有資源を残したまま次のgroupへ進まないことは、通常のcleanup failureと同じ保証です。
group middlewareを持つchildは、その共有資源のlifetime中は同じexecution processで実行します。

## 実行設定の解決

group → target → ケースの経路でtimeoutとretryを項目ごとに重ねます。未指定は引き継ぎ、最後まで指定がなければ5,000ms・0回です。
結果には解決した設定を残し、各ケースの各試行へ同じ期限を適用します。
[timeoutとretry](./execution-options.md)の範囲・上書き規則を使います。

## 一試行の手順

1. **準備**: 期限の計測を開始し、新しい `{}` から、そのケースに至る親→子のstepsを登録順にたどる。setupは戻り値をawaitしてctxを拡張し、次へ進む。`use(...)` は直前のctxとnextを受け取り、nextで後続のstepsとケース本体を実行する。
2. **instrumentation**: 経路上の共通mockとケースのmockを解決し、callsと参照・キーでまとめる。元のdescriptorを保存して差し替えと記録を設定する。
3. **args**: 静的な引数を使うか、argsFromにctxを渡して引数タプルを得る。
4. **target**: 対象を呼び、Promise/thenableならawaitする。戻り値か例外をタグ付きで保持する。
5. **expect**: 設定があれば、ctxと記述子ビルダーで結果の期待を組み立てて検査する。
6. **assertion**: 期待する終了を照合し、結果の条件、呼び出しの条件の順に、各配列の順で検証する。
7. **cleanup**: finallyで差し替えを逆順に復元する。その後、内側から外側へuseのnextが完了し、各middlewareの後処理をawaitする。

ctxの拡張は、直前のctxとsetupの戻り値またはnextに渡した値の列挙可能なownフィールドを新しいオブジェクトへ浅くコピーします。
同名のフィールドは後の値を優先します。入れ物のフィールドは変更不可とし、参照先の値は複製・凍結しません。
argsFromとexpectは同じ最終ctxを受けます。middlewareが受け取ったctxは、その呼び出し時点のままです。
新しく追加したフィールドだけを返せばよく、親のctxを手動でspreadする必要はありません。
setupの戻り値とnextの追加フィールドはplain objectとし、null・プリミティブ・配列・クラスインスタンス等はそれぞれsetup・middlewareの失敗です。
DBなどの資源は `{ db }` のようにフィールドへ入れます。prototypeは通常のObjectかnullを受け付けます。

親のsetup・useも、グループ全体で1回ではなく、実行する各ケースの各試行で呼びます。
setupとuseの前処理・後処理にはモックも記録用のラッパーも適用しません。
記録は全ラッパーの適用後からtargetの終了までです。argsFromでの呼び出しも含まれるため、argsFromは引数を作る処理に留めます。
expect・述語・後始末中の呼び出しは記録に含めません。

## middlewareとnext

`use((ctx, next) => ...)` はケースの一試行を囲むmiddlewareです。
`next(fields)` はctxを拡張して後続を呼び、`next()` は現在のctxをそのまま渡します。
後続はnextを呼んだ非同期コンテキスト内で実行するため、AsyncLocalStorageやコールバック型トランザクションで囲めます。
setupとuseを混ぜた場合も登録順を保ちます。

```text
親useの前処理
  親setup
    子useの前処理
      子setup → 差し替え → args → target → 期待の検証 → 復元
    子useの後処理
親useの後処理
```

middlewareはnextを1回呼び、その呼び出しが返す完了値を返します。
後始末には `try { return await next({ db }) } finally { await db.close() }` を使います。
`return next(...)` ではfinallyが下流の完了前に動くため、この形ではawaitが必要です。

下流でケースの失敗が確定した場合、失敗を結果へ記録した上でnextをrejectします。外側のfinallyは引き続き実行します。
targetのthrowは先に期待と照合するため、期待どおりの例外ではnextをrejectしません。
middlewareがnextの失敗をcatchしても、記録済みの失敗は取り消しません。
後処理自体の失敗はmiddleware段階で追加し、試行のcleanupをincompleteとして後続ケースを中断します。同じ下流の失敗を外側へ伝えるだけでは重複記録しません。

nextの未呼び出し・複数回呼び出し、その呼び出し以外の完了値の返却はmiddlewareの失敗です。
nextの完了前にmiddlewareが終了した場合も失敗とし、開始済みの下流処理と後始末を待ってから次のケースへ進みます。
不正な再呼び出しから下流を再実行することはありません。middleware終了後のnextもrejectし、下流を開始しません。
ケース結果の確定後に発生した呼び出しまで、確定済みの結果へ遡って反映する保証はありません。
nextの省略でケースを成功扱いにはしません。
nextの回数・待機の正しさは型だけでは保証できないため、実行時に検査します。
middlewareがnextより前にthrowした場合は、その失敗を記録して下流を開始しません。

## 呼び出し記録とモック

expectCallsで返した条件から、記録対象を確定します。利用者によるspy登録は不要です。

| 指定 | 実行時の処理 |
|---|---|
| 呼び出し条件だけ | 本物のメソッドを呼びながら記録する |
| モックだけ | 指定された振る舞いへ置き換える |
| 両方 | 指定された振る舞いを呼びながら記録する |

同じオブジェクト・キーに対しては、条件が複数あってもラッパーと呼び出し記録を1つにします。
各条件はその記録に対して独立に検証します。notCalledの対象にもラッパーが必要です。
同じ型の別オブジェクトは別の対象です。
sequenceは呼び出し開始時にonceを一つ消費し、なくなった後はfallbackを使います。消費位置は各試行で初期化します。
nthの番号も開始順で数え、Promiseの完了順では数えません。

本物を記録するラッパーは、呼び出し時のthisと引数を保ち、元の戻り値・Promiseをそのまま返します。
同期throwもそのまま伝播し、throwした呼び出しも回数に含めます。
元の処理の副作用も実行されます。振る舞いを置き換えたい場合はmockを指定します。

記録対象はオブジェクトのプロパティを通る呼び出しです。保存済みの別の関数参照や、モジュール内部のローカルな参照には波及しません。
`target(object, key)` 自体が記録対象なら、実行器はその記録用ラッパーを経由して対象を呼びます。
`.target(fn)` として事前に渡された単独の関数参照は、別プロパティに付けたラッパーを経由しません。

## 正常終了・例外の期待

expectからerrorの記述子が返れば例外、resultの記述子が返れば正常終了を期待します。
expectを省略してexpectCallsだけを書く場合も、正常終了を期待します。
resultとerrorの混在、空配列は型エラーであり、実行時にも失敗とします。

| 期待 | 実際 | 結果 |
|---|---|---|
| 正常終了 | 正常終了 | resultと呼び出し条件を検証 |
| 正常終了 | throw / reject | 予期しない例外として失敗 |
| 例外 | throw / reject | errorと呼び出し条件を検証 |
| 例外 | 正常終了 | 例外が発生しなかったとして失敗 |

`return undefined` と `throw undefined` は別の結果です。
終了の種類が合わない場合は、存在しないresult/errorの述語を呼ばず、評価不能として報告します。
expectの構築・妥当性検査や結果の照合が失敗しても、取得済みの呼び出し記録に対する検証は続けます。
述語のthrowや不一致はその条件の失敗として残し、後続の条件を検証します。

## 途中の失敗

| 失敗した段階 | 扱い |
|---|---|
| setup | 下流を開始せず、外側のmiddlewareのfinallyへ戻る |
| middleware | 未開始の下流は実行せず、開始済みなら完了・後始末を待つ。外側のfinallyへ戻る |
| 差し替え・記録の設定 | targetを呼ばず、適用済みラッパーを復元し、middlewareのfinallyへ戻る |
| args | targetを呼ばず、復元してmiddlewareのfinallyへ戻る |
| target | 戻り値 / 例外として保持し、期待と照合する |
| expect | ケースを失敗にし、呼び出し条件を検証して後始末する |
| assertion | 失敗を記録し、後続を検証して後始末する |
| cleanup | 元の失敗も残し、残りの復元を試み、middlewareのfinallyへ戻る |

準備・差し替え設定・argsの失敗で対象を呼んでいない場合、アサーションを評価しません。
これを「0回だったのでnotCalledに成功した」とは扱いません。
target以外の段階の失敗は、targetに対するerrorの期待を満たしません。
資源の取得と解放はuseの同じスコープに書き、取得途中で失敗した場合の後始末もそこで扱います。

## 適用と復元

そのケースへ至る外側の親→内側の親→子→ケースのモックを、参照・キーの一致で解決します。
他の経路の設定は混ぜません。内側の設定が外側に優先します。
再登録は最初の登録位置を保って振る舞いを上書きします。
実効モックの順に対象を並べ、callsだけにある対象を最初の出現順で追加して適用します。
`target(object, key)` と同じ対象へのmockは、親から引き継いだものも含めて、対象自体の置き換えになるためエラーです。呼び出しの記録だけなら許可します。

書き換え可能なデータプロパティ、またはshadow可能な継承メソッドを対象とします。
アクセサ、非関数、差し替え不能なプロパティはエラーです。観測だけの場合にもこの条件がかかります。
元のdescriptorを保存して復元し、継承メソッドをshadowした場合は追加したown propertyを削除します。

復元の契約はfinallyへ到達する実行を対象とします。
強制終了や終了しないtargetでは後始末を開始できず、外部コードの凍結等で復元できなければ失敗として報告します。

## ケース間の状態

各ケースの各試行で経路上のsetup・`use(...)`を呼び、モックのsequenceと呼び出し記録を作り直します。同じ計画の再実行でも同様です。
caseは、他のcaseが実行されたか、どの順序で実行されたかに依存してはいけません。process.env、module state、global、filesystem、DB等の共有状態を変更する場合は、そのcase自身の境界で必要な初期化・復元を行います。
静的に渡したオブジェクトや、factoryが返した共有値までrunnerが複製する保証はありません。独立性が必要な値はsetup・`use(...)`・argsFromで毎回生成してください。

## 期限・再試行・中断

試行の期限には準備・検証・後始末を含めます。timeoutはe.errorで成功にできません。
標準CLIは設定したshutdownGraceの経過後に未完了の実行環境を終了させ、次のケースへ未停止の処理を持ち越しません。設定方法は[CLIの時間制限](./cli.md#時間制限)を参照してください。
run(plan)単独は同じプロセスの任意コードを停止できず、開始済みの処理と後始末を待ち続ける場合があります。signalの公開APIはありません。

通常の失敗は、後始末が成功し、retryの残りがあれば同じケースを最初から実行します。
定義は再評価せず、準備・モックの動作列・引数の生成・対象・期待を新しい試行として実行します。
timeout・中断・復元や後始末の失敗・定義エラー・middleware契約違反はretryしません。

復元・後始末の失敗では、元の失敗も全て保持して試行をfailedにし、runを中断します。reasonはcleanup-failedですが、timeoutも発生していればtimeoutを優先します。
まだ実行していない実行対象はcancelledとし、元からskip/todo等だったケースの状態は保ちます。
再試行や次のケースによって、片付いていない実行状態を引き継ぐことはしません。
[実行設定の保証](./execution-options.md)と[終了状態の表](./results.md#終了状態の表)を参照してください。

## only / skip / todo

runに渡された全ルートとその子孫のどこかにonlyがあれば、onlyだけを実行します。
他のrunケースはskipped、明示skipはskipped、todoはtodoとして結果に残します。
実行しないケースではsetup・use・target・差し替え・記録を開始しません。
定義時のケース・mock・expectCallsコールバックは、skipでも計画を組み立てるために評価します。

`run(plans, { forbidOnly: true })` はonlyを受付エラーにします。
CLIの `--ci` はこの設定を使います。通常実行ではskip/todoだけでも失敗としません。

## 結果

RunResultは計画順のtestsを持ち、各要素はkindでtestとgroupを区別します。
CaseResultには宣言位置・元の計画内のpath・適用した設定・全試行を残します。構造化した失敗は各試行のfailuresに保持します。
ケースの成否・flaky・失敗一覧はattemptsから求め、CaseResultに写しを持たせません。
試行が空のケースにだけnotRunを必須とし、skipped / todo / 実行前のcancelledを区別します。
各試行のアサーションはexpect / expectCallsの区別と、その配列内の0始まりのindexで対応します。
expectが構築できなかった場合でも、呼び出し条件のindexをずらしません。

実行時に得た値は、検証時点のDiagnosticValueとして保存します。後始末による値の変更で報告を変えません。
診断中にgetterやtoJSONは呼ばず、undefined・循環参照等を型付きの構造としてJSONにも残します。
各条件の不一致・評価失敗・未評価を区別し、実行していない条件を成功にはしません。
位置・状態の集約・JSON形式は[宣言位置と実行結果](./results.md)、表示と終了コードは[CLI](./cli.md)を参照してください。
