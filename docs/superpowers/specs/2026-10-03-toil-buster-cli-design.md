# Toil Buster CLI 設計書

- 日付: 2026-10-03
- ステータス: 承認済み（ブレインストーミング完了）

## 目的

SRE の toil（手作業）削減のため、CloudWatch Logs から特定時間帯のエラーログを
コマンド一発で取得・整形・統計集計する CLI ツールを構築する。

インシデント初動や日常点検で「この時間帯に何が起きたか」を即座に把握することを
成功基準とする。単発スクリプトではなく、npm で配布可能なパッケージ化された
CLI ツールとして提供する。

## スコープ

### MVP（初回リリース）

- ログソース: **CloudWatch Logs のみ**（`FilterLogEvents` API）
- 要約: **統計ベースのみ**（パターン正規化 → グルーピング → 出現頻度ランキング）
- 出力形式: テーブル（デフォルト）/ JSON / Markdown
- ロググループ指定: CLI 引数 + 設定ファイルによるエイリアス

### スコープ外（v2 以降の候補）

- Datadog プロバイダ（`LogProvider` インターフェース実装として追加）
- LLM による要約（`--ai` 等のオプション）
- インタラクティブなロググループ選択
- CloudWatch Logs Insights クエリ (`StartQuery`) ベースの集計

## 技術選定

| 項目 | 選択 | 理由 |
|---|---|---|
| 言語 | TypeScript 7.0 以上 | ユーザー要件。ts-template-base から開始 |
| ランタイム | Node.js 24 | ユーザー要件（Actions プラグイン最新メジャー） |
| CLI フレームワーク | commander | 軽量・標準的。本規模に適切 |
| テーブル出力 | cli-table3 + chalk | ターミナル表示 |
| AWS SDK | @aws-sdk/client-cloudwatchlogs v3 | FilterLogEvents + ページネーション |
| 設定検証 | zod | 設定ファイルの型検証 |
| テスト | vitest + coverage | カバレッジ 80% 以上目標 |

## アーキテクチャ

```
src/
├── cli/
│   ├── index.ts           # エントリポイント (bin: tb)
│   └── errors-command.ts  # `errors` コマンド定義
├── providers/
│   ├── types.ts           # LogProvider インターフェース + LogEvent 型
│   └── cloudwatch.ts      # CloudWatchProvider (FilterLogEvents + ページング)
├── core/                  # 純関数（副作用なし・テスト容易）
│   ├── duration.ts        # "10m" / "1h" / "2d" パース
│   ├── normalize.ts       # メッセージ正規化（変動値マスク）
│   └── aggregate.ts       # グルーピング + 頻度集計
├── render/
│   ├── table.ts           # cli-table3 + chalk
│   ├── json.ts            # 構造化出力
│   └── markdown.ts        # 報告用 md テーブル
└── config/
    └── load.ts            # 設定ファイル読み込み + zod 検証
```

### LogProvider インターフェース

```ts
interface LogQuery {
  logGroup: string;
  startTime: Date;
  endTime: Date;
  filterPattern: string;
  limit: number;
}

interface LogEvent {
  timestamp: Date;
  message: string;
}

interface LogProvider {
  fetch(query: LogQuery): Promise<{ events: LogEvent[]; truncated: boolean }>;
}
```

`truncated` は `--limit` 到達による打ち切りを示す。Datadog 追加時はこの
インターフェースを実装する。

## CLI UX

コマンド名は `tb`（toil-buster の短縮）。パッケージ名は `toil-buster-cli`。

```
tb errors <group> [options]

  --time, -t <dur>    時間窓。デフォルト 15m（10m / 1h / 2d 形式）
  --level <levels>    対象レベル。デフォルト ERROR（WARN,ERROR のように複数可）
  --format <fmt>      table | json | md。デフォルト table
  --top <n>           頻度ランキング上位件数。デフォルト 20
  --limit <n>         取得最大イベント数。デフォルト 1000
  --filter <pattern>  CloudWatch フィルタパターン直接指定（level 指定を上書き）
  --profile <name>    AWS profile
  --region <region>   AWS region
```

### 設定ファイル

`~/.config/toil-buster/config.json`（`XDG_CONFIG_HOME` 対応、zod で検証）:

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

- `tb errors prod-api --time 10m` のようにエイリアス指定が可能
- エイリアス未定義の文字列はロググループ完全名として直接指定できる
- ファイルが存在しなければデフォルト値で動作（設定は必須でない）

## データフロー

```
config 読込 → エイリアス解決 → duration パース
  → CloudWatchProvider.fetch（FilterLogEvents を nextToken でページング）
  → normalize（各メッセージの変動値をマスク）
  → aggregate（正規化済みメッセージでグルーピング）
  → render（table / json / md）
```

- CloudWatch 側フィルタは**タームフィルタ**（`?ERROR ?Error` 形式）で粗く絞り込む。
  JSON ログ・プレーンテキスト両方に機能するため
- レベルの精密判定は行わず、タームフィルタ + クライアント側集計に委ねる
  （MVP の簡素化。構造化パターンは v2 候補）

### 正規化ルール（normalize.ts）

メッセージ内の変動値を以下のプレースホルダに置換してからグルーピングする:

| 対象 | 置換後 | 備考 |
|---|---|---|
| UUID | `<uuid>` | |
| ISO8601 タイムスタンプ | `<ts>` | |
| IP アドレス | `<ip>` | IPv4 / IPv6 |
| 長い数値列 | `<num>` | 4 桁以上の連続数値（HTTP ステータス等の 3 桁以下は保持） |
| 16 進数列 | `<hex>` | `0x` prefixed / 8 文字以上の hex |

置換順序が結果に影響するため、順序と境界値のテストを必須とする。

### 集計結果の型

```ts
interface ErrorGroupStats {
  pattern: string;     // 正規化済みメッセージ
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  sample: string;      // 代表的な生メッセージ
}

interface SummaryResult {
  logGroup: string;
  timeWindow: { start: Date; end: Date };
  totalEvents: number;
  truncated: boolean;
  groups: ErrorGroupStats[];  // count 降順
}
```

render は `SummaryResult` のみを受け取り、出力形式の差異を吸収する。

## エラー処理

| 状況 | 挙動 | 終了コード |
|---|---|---|
| 正常完了（0 件含む） | 0 件なら「該当時間帯にエラーなし」と表示して正常終了 | 0 |
| 実行時エラー全般 | 1 行の要約 + リカバリヒントを stderr へ | 1 |
| AWS 認証エラー | `aws configure` / `--profile` 指定の確認を促す | 1 |
| ロググループ不存在 | グループ名 + 類似エイリアス候補を表示 | 1 |
| スロットリング | 指数バックオフで最大 3 回再試行 | — |
| `--limit` 到達 | 打ち切り + 「--limit で切り詰め」警告表示 | 0 |

- 引数の使い方ミスは commander 標準のヘルプ表示
- `--format json` 時はエラーも構造化（`{ "error": ... }`）して stderr へ出力し、
  パイプ後段を破壊しない

## テスト方針

- **ランナー**: vitest + coverage（目標 80% 以上）
- **純関数**（`duration` / `normalize` / `aggregate` / `config`）: 網羅的単体テスト。
  特に normalize はマスク順序・境界値（UUID / 数値 / IP / 16 進の混在）を重点的に
- **Provider**: AWS SDK クライアントをモックし、ページネーション・再試行・
  エラー系を検証
- **CLI**: ヘルプ表示・設定なし実行・0 件時の終了コードを spawn して E2E 検証
- AWS 実環境への接続テストは行わない（CI 再現性・コスト面）

## CI / セキュリティ（security-base 適用）

- **開始方法**: `ts-template-base` をクローンして骨組みを流用
- **ワークフロー**（`.github/workflows/`）:
  - `ts-security.yml` — reusable ローカルコピー参照（npm audit +
    eslint-plugin-security、Node 24）
  - `secret-scan.yml` — Trivy によるシークレット検出
  - `uses:` はすべて**コミットSHAピン留め**（`@v4` 等のタグ参照は禁止）
- **Dependabot**: npm + actions の週次更新
- リポジトリを GitHub に作成後、`apply-security.sh y-maeda1116/toil-buster-cli`
  を実行（脆弱性アラート・プライベート脆弱性報告・シークレットスキャン有効化）
- シークレットは環境変数 / AWS credential chain のみ（ハードコード禁止、
  `.env` は gitignore）

## 配布

- npm パッケージ（`bin` エントリで `tb` コマンドを提供）
- `npx` 実行も可能な構成
- publish は手動トリガーとし、CI からの自動 publish は行わない
