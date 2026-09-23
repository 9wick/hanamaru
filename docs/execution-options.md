# timeoutとretry

実行設定をcontextとして下流へ渡し、指定した項目だけを上書きします。
group・target・ケースで同じ `.timeout(ms)` / `.retry(count)` を使います。

```ts
import { Test } from 'hanamaru'
import { add } from './math.ts'

const addition = new Test()
  .target(add)
  .timeout(2_000)
  .it('足す', t => t
    .args(1, 2)
    .expect(e => [e.result.toBe(3)]))
  .it('再試行せず足す', t => t
    .timeout(500)
    .retry(0)
    .args(2, 3)
    .expect(e => [e.result.toBe(5)]))

export const tests = new Test()
  .timeout(5_000)
  .retry(2)
  .group(addition)
```

| ケース | timeout | retry |
|---|---|---|
| 足す | 2,000ms（targetで指定） | 2（groupで指定） |
| 再試行せず足す | 500ms（ケースで指定） | 0（ケースで指定） |

## 継承と上書き

既定値 → 外側のgroup → 内側のgroup → target → ケースの順で解決します。
未指定の項目は親から引き継ぎ、同一スコープでの再設定は後の値を使います。
timeoutだけを上書きしても、親のretryは残ります。retry(0)で継承した再試行を無効にできます。

共通設定は最初のケース・groupまで、ケースの設定はexpect / expectCallsを開始するまで変更できます。
変更は新しいビルダーへ反映し、元の定義や兄弟へ波及しません。
eachの各行も同じケース設定を使い、tで行ごとに上書きできます。

設定は各ノード・ケースの `config: ExecutionConfig` に明示された値だけを保持します。
実行時の値は `CaseResult.config: ResolvedExecutionConfig` から得られます。
middlewareが作る利用者のctxへ予約フィールドを足す必要はありません。

## timeout

単位はミリ秒、既定値は5,000msです。正の有限値を指定し、不正値は定義エラーにします。
0を無制限の意味にはしません。実行計画を直接受け取る場合も同じ条件を受付時に検査します。

期限はmiddlewareの前処理・対象・検証・後処理を含む一試行全体に適用します。
groupで指定したtimeoutは配下の各ケースの試行期限の既定値で、グループ全体の合計時間ではありません。
targetで指定したtimeoutも、対象関数だけの制限ではありません。
retryする場合は、各試行を同じ期限で計り直します。

```text
✗ 取得する  src/user.test.ts:18:4
  timeout: 1000ms (target)
  cleanup: 未完了
  run: 中断。未実行の3ケースはcancelled
```

括弧内は超過時の実行段階です。結果には期限・段階・後始末の完了状態を残します。
timeoutをtargetに対するe.errorの期待で成功にはできません。

middleware自身の期限を超えた場合は、前処理・後処理のどちらで超えたかも段階に残します。

```text
✗ 取得する  src/user.test.ts:18:4
  timeout: 10000ms (middleware before)
  cleanup: 未完了
  run: 中断。未実行の3ケースはcancelled
```

この期限は `middleware(fn, { timeout })` で指定し、既定値は10,000msです。
試行期限とは別に、前処理と後処理のそれぞれへ独立に適用します。[middleware](./middleware.md)を参照してください。

期限を超えたら後続を開始せず、そのrunを中断します。終了済みの結果を残し、未実行の実行対象ケースはcancelledにします。
元からskip/todo、onlyによる除外だったケースはその状態を保ちます。
超過した試行はfailed、runはfailed / timeoutです。[終了状態の表](./results.md#終了状態の表)で、cleanup失敗や割り込みとの組み合わせも定めています。
実行中の処理が戻れば後始末へ進みますが、標準CLIは設定したshutdownGraceの経過後、未完了の実行環境を終了させます。
猶予と収集期限は[CLIの時間制限](./cli.md#時間制限)で変更でき、ケースのtimeoutとは別に扱います。
強制終了後のfinallyや外部資源の解放は保証しません。signalを受け渡す公開APIはありません。

同一プロセスの `run(plan)` は任意コードを強制停止できません。
後続を開始せず、開始済みの処理と後始末が終わるまで完了を待つため、終了しない処理では戻らない場合があります。
同期処理が実行スレッドを塞ぐ間は期限の検出も遅れます。経過後に制御が戻っても、超過した試行を成功にはしません。
標準CLIは実行環境の終了までを担い、この場合にも停止を保証します。

## retry

既定値は0です。0以上の安全な整数を指定し、不正値は定義・計画受付時にエラーにします。
retry(2)は追加2回、最初と合わせて最大3回です。
groupやtargetに設定しても、失敗したケースだけを再試行します。
eachも失敗した行だけを再試行し、成功した兄弟や行は繰り返しません。

各試行でmiddleware・モックのsequence・呼び出し記録を作り直します。
対象やmiddlewareの通常の例外、アサーションの不一致・評価失敗は、後始末を完了できた場合に再試行します。
timeout・Ctrl+Cによる中断・復元や後始末の失敗・定義エラーは再試行しません。
nextの未呼び出し等のmiddleware契約違反も再試行で解消する扱いにはしません。
復元や後始末に失敗した場合は、未実行の実行対象をcancelledとしてrunを中断します。
静的な引数や外部DBの状態を自動で巻き戻す契約はありません。

```text
⚠ 外部サービスから取得する  passed on attempt 2/3 (flaky)
  attempt 1: unexpected error: connection reset
  attempt 2: passed
```

失敗後に成功したケースも全試行を残します。最後の試行がpassedで、それ以前にfailedがあれば、reporterはflakyとして表示します。
CaseResultにstatusやflakyのフィールドは持たせません。各試行の記録から求めます。
既定ではrunも成功できます。CLIの `--fail-on-flaky` または `run(plan, { failOnFlaky: true })` ではrunをfailedにします。
最後の試行のpassedと、過去を含む各試行の記録は変更しません。
