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
```

### オプション

| オプション | 説明 | デフォルト |
|---|---|---|
| `--time, -t <dur>` | 時間窓 (`10m` / `1h` / `2d`) | `15m` |
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
npm run typecheck  # tsgo (TypeScript 7系)
npm run build   # tsup → dist/index.js
```

## ライセンス

MIT
