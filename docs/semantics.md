# 実行セマンティクス

このページは `run(plan)` が実行する契約を定める。
APIの実装はまだなく、ここに書いた実行時保証は実装・検証対象である。

## 定義と実行の境界

`new Test()` のチェーンはビルダーコールバックを評価し、定義を組み立てる。
`.plan()` が `TestPlan` を返し、`run()` がその計画を実行する。
setup・target・遅延値・fake・述語は、定義とplan取得では実行しない。
テストモジュールのトップレベルコードは通常のimportと同様に動く。

## 計画の受付

```ts
const result = await run(tests.plan())
const results = await run([first.plan(), second.plan()])
```

単一計画または計画配列を受け取る。配列は渡された順、ケースは宣言順に直列実行する。
結果の `tests` も計画の順に並び、各ケースは計画内のIDに対応する。

version、計画の構造、重複ID・重複登録等を実行前に検査する。
空の計画配列は受付エラー。受付エラーではsetupを開始せずPromiseをrejectする。
ケース中の失敗は結果に残し、他の実行対象ケースを続ける。

同一プロセスで複数の `run()` が重ならないようにし、重複呼び出しは受付エラーにする。
オブジェクトのプロパティ差し替え中に別の実行を混ぜない。

## 1ケースの手順

1. **setup**: createを呼び、Promiseならawaitしてctxを得る。省略時は新しい `{}`。
2. **binding**: targetFrom、mockFromのselector、モックの振る舞いの `*From` を評価する。
3. **mock**: 登録先を検査し、元のプロパティdescriptorを退避してモックを適用する。
4. **args**: 静的な引数を使うか、argsFromにctxを渡して引数タプルを得る。
5. **target**: 対象を呼び、Promise/thenableならawaitする。戻り値か例外をタグ付きで保持する。
6. **assertion**: 期待した終了の種類を照合し、各アサーションをすべて評価する。
7. **cleanup**: finallyでモックを逆順に復元し、setup.disposeがあればctxを渡してawaitする。

selectorとモックの値factoryはモック適用前に実行する。fixtureを構築したり対象を取得したりする処理から、
既にモックされた依存を呼ぶことはない。setup内の呼び出しはモックの検証対象にもならない。

呼び出し記録はモック適用直後に開始し、targetの終了時までを対象とする。
argsFrom内でモックを呼んだ場合も記録されるので、argsFromは引数を組み立てる処理に留める。
アサーションと後始末中の呼び出しは検証対象に含めない。

## 正常終了・例外の期待

| 計画のoutcome | 実際 | 結果 |
|---|---|---|
| `return` | 正常終了 | resultとmockの条件を検証 |
| `return` | throw / reject | 予期しない例外として失敗 |
| `throw` | throw / reject | errorとmockの条件を検証 |
| `throw` | 正常終了 | 例外が発生しなかったとして失敗 |

モックだけを検証していても、outcomeの検証を省略しない。
`return undefined` と `throw undefined` は別の結果として扱う。

終了の種類が合わないときも、取得済みの呼び出し記録に対するモックの検証は続ける。
存在しないresult/errorを必要とするアサーションは評価不能として報告し、その述語を呼ばない。
アサーション自身や期待値factoryのthrowは、そのアサーションの失敗になる。

## 途中の失敗

- setup失敗: targetを呼ばない。ctxを得られていないのでdisposeは呼べない。create側が途中まで取得した資源を片付ける。
- binding失敗: targetを呼ばず、成功済みsetupのdisposeを呼ぶ。
- mock適用途中の失敗: 適用済みの分だけ復元し、disposeを呼ぶ。
- args失敗: targetを呼ばず、適用したモックを復元し、disposeを呼ぶ。
- target失敗: outcomeに従って判定し、アサーション評価後に後始末する。
- assertion失敗: 後続アサーションを評価し、後始末する。
- 復元・dispose失敗: ケースを失敗にする。元の失敗も残し、残りの復元・disposeも試みる。

setup・binding・mock・argsの失敗ではtargetの結果がないため、アサーション評価へ進まない。
これらの失敗を `expectError` の成功として扱わない。

## モックの適用・復元

各ケースには共通登録とoverrideを解決した実効モック一覧がある。その順で適用する。
複数の登録が同じオブジェクトの同じキーへ解決されたら、適用前にエラーにする。
`target(object, key)` と同じ登録先へのmockも、対象自体の差し替えになるためエラーにする。

書き換え可能なデータプロパティ、またはshadow可能な継承メソッドを対象にする。
アクセサ、非関数、差し替え不能なプロパティはエラー。
復元は元のdescriptorを戻す。継承メソッドをshadowした場合は追加したown propertyを削除する。

復元保証は制御がfinallyへ到達する通常の実行についてのもの。
プロセスの強制終了、targetが終わらない場合、外部コードがプロパティを凍結した場合まで成功を保証しない。
復元に失敗した事実は隠さず結果に残す。

## ケース間の独立性

setupを毎回呼び、呼び出し記録を毎回作り直す。
同じ計画を再実行する場合も同様だが、静的に渡されたオブジェクトまで複製はしない。
fixture factoryが共有オブジェクトを返したり、fakeが外の状態を変更したりすれば、その状態は共有される。
独立性が必要な値はケースごとに生成する。

## only / skip / todo

`run()` に渡された計画全体のどこかにonlyがあれば、onlyのケースだけ実行する。
他のrunケースはskippedとして結果に残す。明示skipはskipped、todoはtodoのまま。
いずれもsetup・targetを呼ばない。

`run(plans, { forbidOnly: true })` はonlyを受付エラーにする。
CLIの `--ci` はこの設定を使う。通常実行ではskip/todoだけでも失敗とはしない。

## 結果

`RunResult` は計画順の `tests` を持ち、各 `TestResult` はケースID・status・失敗一覧を持つ。
失敗には発生段階を記録し、設定・実行前のエラーと、ケースの失敗を混同しない。
実際の戻り値・例外の全体を結果JSONへ埋め込むことは要求しない。失敗内容はmessageとして報告する。

CLIの終了コードは[CLI](./cli.md)に定める。
