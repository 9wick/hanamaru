# テストをグループにまとめる

groupは完成した子と共通設定をまとめます。資源の共有とケース間の順序依存は別です。mockを親から任意の子へ注入する操作はありません。

## 関連するテストと共通設定

子のtargetと検証は子に書き、groupには環境の寿命と共通設定を置きます。各effectfulケースのenvironmentが、依存と観測器を評価ごとに提供します。

## group全体をmiddlewareで囲む

次の例は実際のファイルを書き、その内容を観測します。共有するのは親ディレクトリだけで、ファイルと観測器はケースごとに作ります。

<!-- example: none — 公開APIの記述契約：実環境の共有と独立した観測 -->
```ts
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Test, environment, middleware, registerTest } from 'hanamaru'

const save = (path: string, text: string) => writeFile(path, text)
const files = new Test<{ root: string }>().target(save).effectful()
  .use(environment(async (ctx, scope, next) => {
    const directory = await mkdtemp(join(ctx.root, 'case-'))
    try {
      const path = join(directory, 'message.txt')
      await writeFile(path, '')
      const content = scope.state({ evidence: 'real-effect', read: () => readFile(path, 'utf8') })
      return await next({ path, content })
    } finally {
      await rm(directory, { recursive: true })
    }
  }))
  .it('内容を保存する', t => t.argsFrom(c => [c.path, 'hello'])
    .expect(e => [e.state(e.ctx.content).toEqual('hello')]))

registerTest(new Test().group('files', middleware(async (_, next) => {
  await mkdir('.tmp', { recursive: true })
  const root = await mkdtemp('.tmp/hanamaru-')
  try {
    return await next({ root })
  } finally {
    await rm(root, { recursive: true })
  }
}), [files]))
```

## 依存の要求と供給

子が必要な値だけを `new Test<R>()` で要求します。供給元のuse/groupを子の型へ埋め込みません。親は必要な時点までに値を供給し、不足や順序違反を型で拒否します。

環境のscopeはgroup middlewareに渡しません。environmentをgroupへ直接渡すこともできません。groupで資源を共有し、子のenvironmentで評価固有のトークンを発行します。

<!-- example: none — 公開APIの記述契約：供給の禁止例。filesは上の定義 -->
```ts
// 型エラー: rootを供給していない完成定義は登録できない。
registerTest(files)
// 型エラー: Testに任意関数を差し替えるmockはない。
new Test().mock(console, 'log', m => m.returns(undefined)).group([files])
```

## 名前は任意

groupの名前は表示用です。省略や同名を許し、実行箇所は位置と階層で区別します。名前を入力・参照のIDとして使わせません。

## 入れ子にして設定の範囲を分ける

groupを入れ子にしてmiddleware・timeout・retryの適用範囲を分けます。共通の環境値は内側で上書きできますが、子の用途をpureからeffectfulへ変えたり、対象外の操作を許可したりはできません。

## 親で用意したコンテキストを子へ渡す

group middlewareのnextで供給した値は、子の各評価のコンテキストへ入ります。子のenvironmentはその値を読み、評価専用の状態と観測器を作れます。子の後処理を終えてから、親の資源を解放します。

## 別ファイルのテストをまとめる

子をexportして親へimportできます。CLIの実行対象は親の `registerTest` で登録します。子のexportを独立実行の指定にはしません。[登録](registration.md)に従います。

## 定義と実行の条件

子は非空で、各子は完成した定義である必要があります。グループはtargetやケースを持たず、完成した子を合成します。親も子もイミュータブルな定義値で、別経路への合成で書き換わりません。

## timeoutとretryも継承する

timeoutは各試行に、retryは失敗したケースの再試行に適用します。group全体の再実行ではありません。group middlewareは全子を一度囲み、environmentは評価ごとに作り直し、propertyの生成例・縮小候補の間でも初期化します。
