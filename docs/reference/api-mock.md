# infra境界の代替

実際の効果を観測することを基本とし、直接観測が困難な場合や外部障害の再現にだけ境界の代替を使います。[完結した例と禁止例](../guides/writing-tests.md#infra境界を代替する)を参照してください。

## 境界を選ぶ

environmentの準備中に `scope.boundary(object, key)` でBoundary<F>を作り、nextからケースへ渡します。caseは `replace(ctx => ctx.outbound, m => m.rejects(error))` のようにトークンから選びます。

scopeは環境だけが持ち、next以降には発行できません。トップレベルにboundary構成子はなく、caseへobject/keyを直接渡せません。純粋関数の入口にはenvironment・replace・expectCallsがありません。

環境は信頼境界です。提供者が内部ヘルパーをinfraと偽って登録しないことまでは型で証明しません。APIが防ぐのはcaseからの無制限な介入と、トークンの種類・所有者・寿命の違反です。

## 振る舞い

returns / resolves / throws / rejectsを境界の型に応じて使います。任意コードを差し込むcallsFakeはありません。Resultの失敗値は戻り値として扱います。

## 呼び出しごとに動作を変える

returnsOnce / resolvesOnce / throwsOnce / rejectsOnceを並べ、最後に通常動作を置きます。onceだけでは未完了です。列を使い切った後の暗黙のundefinedはありません。開始順で消費し、評価ごとにリセットします。

## 共通設定とケースの上書き

environmentは境界の権限と実資源を提供し、置換する条件はケースごとに指定します。groupやTestの共通mockはありません。条件の再利用は、許可済みの型付きトークンを受け取る通常のヘルパーで行えます。caseが新たな権限を追加することはできません。

## 検証

`expectCalls(c => [c.boundary(c.ctx.outbound).calledOnceWith('hello')])` のように記述します。calledTimes / calledWith / calledOnceWith / calledNthWith / notCalledを提供します。引数型はFから推論します。calledTimesは0以上、calledNthWithは1以上の安全な整数を要求します。

calledWithは一致する呼び出しが1件以上、calledOnceWithは合計1回かつ引数一致です。calledNthWithは開始順のn番目だけを照合し、合計回数は別条件です。本物を呼びながら記録する場合も、許可された境界に限ります。

記録はtargetの開始からsettleまでです。実効果・代替環境の効果・呼び出し記録を診断で区別し、境界が呼ばれたことを効果の達成と同一視しません。

## 差し替えの範囲

その評価のscopeが発行したBoundaryだけに適用します。同一評価内のobject/keyの重複登録、別評価・別試行のトークン、対象自身・操作集合の構成要素の置換を拒否します。前評価の復元・解放後は、共有した同じobject/keyへ新しいトークンを発行できます。同じattemptであることは前候補のトークンを再利用する許可にはなりません。

作用するのは登録objectのmethod経由の呼び出しです。保存済み参照やmodule内部へ暗黙に介入しません。アクセサ・非関数・書き換え不能なプロパティは拒否します。適用済みの置換は終了時に逆順で復元し、解放不能なら後続を中断します。
