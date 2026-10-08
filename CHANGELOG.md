# 変更履歴

## 0.1.0

hanamaruの最初の実用版です。

- `Test` のチェーンで関数・メソッドを対象にし、型推論を保って `it` / `each` のケースを定義できます。
- 戻り値・例外・依存の呼び出しを検証し、モックの振る舞いを共通設定またはケースごとに指定できます。
- middlewareとgroupで環境の準備・後始末・コンテキストの供給を記述できます。共有環境はresourceで依存関係と寿命を宣言できます。
- `registerTest` で登録したテストをCLIが収集し、ファイル・project・filterで選択できます。
- timeout・retry、試行ごとの結果、宣言位置を含む診断、pretty / JSONの出力に対応します。
- Node.js 22.18以上、Bun 1.3以上、Deno 2.9.2以上、TypeScript 5.8以上を対象にします。

初版は直列実行です。watch・カバレッジ計測・並列実行は提供しません。
詳しい保証と対応範囲は[制約と実装状況](docs/reference/limitations.md)を参照してください。

パッケージの概要は[README](README.md)、導入手順は[入門ガイド](docs/guides/getting-started.md)を参照してください。
