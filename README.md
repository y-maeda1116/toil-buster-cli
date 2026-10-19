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
```

### ロググループの指定

`<group>` には次のいずれかを指定できます（カンマ区切りで併用可、重複は自動排除）:

- **エイリアス**: 設定ファイルの `aliases` で解決（例: `prod-api`）
- **完全名**: `/aws/lambda/prod-api` のようなロググループ名そのもの
- **末尾ワイルドカード**: `prod-api-*` のように末尾 `*` で prefix 一致するグループを
  DescribeLogGroups で展開（展開数は最大 20 グループ。0 件の場合はエラーで終了）

複数グループを指定した場合、各グループごとに fetch → 集計して出力します。
`--format table` / `md` はグループごとのセクション連結、`--format json` は結果の配列になります。

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
| `--profile <name>` | AWS profile | — |
| `--region <region>` | AWS region | — |

### 設定ファイル

`~/.config/toil-buster/config.json`:

```json
{
  "aliases": {
    "prod-api": "/aws/lambda/prod-api"
  },
  "defaults": {
    "region": "ap-northeast-1",
    "time": "15m"
  }
}
```

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
