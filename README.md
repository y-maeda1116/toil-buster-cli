# toil-buster-cli

Toil Buster CLI (`tb`) — SRE 向け CloudWatch Logs エラー抽出・統計ツール。
コマンド一発で指定期間のエラーログを取得し、パターン正規化して出現頻度ランキングを出力します。

## インストール

```bash
npm install -g toil-buster-cli
```

## 使い方

```bash
# 直近 10 分の ERROR を抽出して頻度ランキング表示
tb errors prod-api --time 10m

# WARN も含めて Markdown で報告用出力
tb errors prod-api --level WARN,ERROR --format md

# JSON で機械処理
tb errors /aws/lambda/prod-api --format json | jq '.groups[0]'

# 昨日の障害時間帯を振り返り調査 (絶対時刻指定)
tb errors prod-api --since 2026-10-18T14:00 --until 2026-10-18T15:30

# 5 分ごとのバーストをタイムライン表示
tb errors prod-api --time 2h --bucket 5m

# 直前 1 時間との比較で「新規 / 増えた」エラーだけ注目
tb errors prod-api --time 1h --compare 1h

# 複数グループをまとめて確認 (カンマ区切り)
tb errors prod-api,batch-worker --time 1h

# ワイルドカードでパターン一致するグループを一括抽出 (DescribeLogGroups で展開)
tb errors "prod-api-*" --time 30m

# 既知エラーを抑制して新しいパターンだけ注目 (--show-ignored で確認モード)
tb errors prod-api --time 1h
tb errors prod-api --time 1h --show-ignored

# インシデントレポートとして Markdown 保存 (実行時刻・フィルタ条件を含む)
tb errors prod-api --time 2h --save incident-20261019.md

# 直近の生ログを時系列順に表示
tb tail prod-api --last 10m --lines 100

# 正規表現に一致した行と前後 3 行の文脈を表示
tb show prod-api --pattern "TimeoutError" --context 3

# CloudWatch Logs Insights クエリで 1 分ごとのエラー件数を集計
tb insights prod-api --time 2h

# Insights クエリを直接指定して自由に集計
tb insights prod-api --time 1h --query 'stats count() as count by @logStream | sort count desc'

# デプロイ後の経過監視: 30 秒間隔で再取得して再描画 (Ctrl+C で終了)
tb errors prod-api --time 30m --live 30s

# 10 回だけ監視して自動終了
tb errors prod-api --live 1m --count 10

# CI / cron で閾値超過時に異常終了 (exit 2)
tb errors prod-api --time 10m --fail-over 100 --format json
```

### ロググループの指定

`<group>` には次のいずれかを指定できます（カンマ区切りで併用可、重複は自動排除）:

- **エイリアス**: 設定ファイルの `aliases` で解決（例: `prod-api`）
- **完全名**: `/aws/lambda/prod-api` のようなロググループ名そのもの
- **末尾ワイルドカード**: `prod-api-*` のように末尾 `*` で prefix 一致するグループを
  DescribeLogGroups で展開（展開数は最大 20 グループ。0 件の場合はエラーで終了）

複数グループを指定した場合、各グループごとに fetch → 集計して出力します。
`--format table` / `md` はグループごとのセクション連結、`--format json` は結果の配列になります。

### 生ログの調査 (`tail` / `show`)

集計 (`errors`) → 個別調査を CLI 内で完結させるサブコマンドです。

- **`tb tail <group>`**: 直近の生ログを時系列昇順で表示（`--last` 遡る窓、`--lines` 最大行数）
- **`tb show <group> --pattern <regex>`**: 正規表現に一致した行と前後の文脈を表示
  （`--context` 文脈行数、マッチ行には `*` を付ける。複数マッチの文脈が重なる場合は 1 つの区間にマージ）

どちらも `errors` と同じロググループ指定（エイリアス / 完全名 / 末尾ワイルドカード）が使え、
時刻は UTC ISO 8601 で出力します。

### Insights クエリ (`insights`)

CloudWatch Logs Insights (StartQuery / GetQueryResults) でサーバーサイド集計を行うサブコマンドです。
FetchLogEvents より大量のログを効率よく集計したいときに使います。

- **`tb insights <group>`**: 既定クエリ（`filter @message like /ERROR/ | stats count() as count by bin(1m) as bucket | sort bucket asc`）
  で 1 分ごとの件数をテーブル表示。`--level WARN,ERROR` で対象レベルを変更（OR 条件で filter）
- **`--query <queryString>`**: Insights クエリ構文で直接指定（既定クエリを上書き）。複数グループは
  `errors` と同じ指定（エイリアス / 完全名 / 末尾ワイルドカード）が使え、すべて 1 クエリに渡ります
- クエリは `--interval`（デフォルト 1s）ごとにポーリングし、`--timeout`（デフォルト 60s）以内に
  完了しなければエラー終了します。`--format json` で行オブジェクトの配列として出力

### オプション

| オプション | 説明 | デフォルト |
|---|---|---|
| `--time, -t <dur>` | 時間窓 (`10m` / `1h` / `2d`) | `15m` |
| `--since <datetime>` | 開始時刻 (ISO 8601)。`--time` と併用不可。省略時は `--until` から `--time` 分遡る、または現在時刻 | — |
| `--until <datetime>` | 終了時刻 (ISO 8601)。省略時は現在時刻 | 現在時刻 |
| `--bucket <dur>` | タイムラインのバケット幅 (例: `5m`)。指定時は時間別カウントを表示 | — |
| `--compare <dur>` | 直前の指定幅の窓との比較。`new` / `increased` / `decreased` / `resolved` を表示 | — |
| `--level, -l <levels>` | 対象レベル (カンマ区切り) | `ERROR` |
| `--format, -f <fmt>` | `table` / `json` / `md` | `table` |
| `--top <n>` | ランキング上位件数 | `20` |
| `--limit <n>` | 取得最大イベント数 | `1000` |
| `--filter <pattern>` | CloudWatch フィルタパターン直接指定 | — |
| `--show-ignored` | config `ignore` に一致する既知パターンも表示する | 除外 |
| `--save <path>` | メタ情報付きインシデントレポート (Markdown) を指定パスに保存。stdout 出力は通常どおり | — |
| `--live <dur>` | 監視モード: 指定間隔で再取得して画面をクリアし再描画。Ctrl+C で終了 | — |
| `--count <n>` | `--live` の繰り返し回数。省略時は Ctrl+C まで | — |
| `--fail-over <n>` | エラー件数 (取得イベント総数) が閾値を超えたら exit 2。終了コードは 0=正常 / 1=コマンドエラー / 2=閾値超過 | — |
| `--profile <name>` | AWS profile | — |
| `--region <region>` | AWS region | — |

### 設定ファイル

`~/.config/toil-buster/config.json`:

```json
{
  "aliases": {
    "prod-api": "/aws/lambda/prod-api"
  },
  "ignore": [
    "NoSuchElementException",
    "/Connection reset by peer/"
  ],
  "defaults": {
    "region": "ap-northeast-1",
    "time": "15m"
  }
}
```

### 既知エラーの抑制 (`ignore`)

`ignore` に登録したパターンはデフォルトで集計から除外され、出力の `ignored: N` に除外件数だけが表示されます。
除外するかどうかは正規化済みパターンに対して判定します:

- `/.../` 形式 → 正規表現（部分一致）。例: `/Connection reset by peer/`
- それ以外 → 完全一致。例: `NoSuchElementException`

`--show-ignored` を付けると除外パターンも含めて表示し、既知ノイズを確認できます。
`--compare` と組み合わせれば「新規パターンのみ」の抽出が強化されます。

認証は AWS 標準 credential chain（環境変数 / shared config / `--profile`）を利用します。

## 開発

```bash
npm install
npm test        # vitest
npm run lint    # eslint (+ eslint-plugin-security)
npm run typecheck  # tsc (TypeScript 7系)
npm run build   # tsup → dist/index.js
```

> **Note:** TypeScript 7 は `typescript-eslint`・`tsup` が依存する JavaScript コンパイラ API をまだ提供していません。
> [upstream の side-by-side 構成](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6-0)に従い、
> `@typescript/native` を `typescript@7` のエイリアス（`tsc` を提供）、`typescript` を `@typescript/typescript6` のエイリアスとし、
> `typescript` API を読み込むツールにはサポート対象の 6.x API を渡しています。

## ライセンス

MIT
