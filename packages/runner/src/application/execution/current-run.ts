/**
 * 1回のrunはmodule mockで共有オブジェクトを書き換え、収集スコープのポインタも使う。
 * 同じプロセスで2つのrunが重なると互いの差し替えと復元を壊すため、
 * 重なりをこのポインタ1つで見つけて2つ目をthrowで止める。
 * 呼び出し側ごとの錠にすると別の入口から始まったrunとの重なりを見逃す。
 */
let running = false

export async function runExclusively<T>(body: () => Promise<T>): Promise<T> {
  if (running) throw new TypeError('a run is already active')
  running = true
  try {
    return await body()
  } finally {
    running = false
  }
}
