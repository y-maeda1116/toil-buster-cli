# Toil Buster CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CloudWatch Logs から指定期間のエラーログを取得・正規化・頻度集計して table/json/md 出力する npm 配布可能 CLI `tb` を構築する。

**Architecture:** 純関数コア（duration/normalize/aggregate）+ `LogProvider` インターフェースで AWS から分離した provider + `SummaryResult` を受け取るだけの renderer。commander ベースの CLI は依存注入（providerFactory/env/now）により AWS SDK を触らずにテストする。

**Tech Stack:** TypeScript (tsgo = @typescript/native-preview 7系) / Node 24 / commander ^15 / cli-table3 ^0.6 / chalk ^6 / zod ^4 / @aws-sdk/client-cloudwatch-logs ^3 / vitest ^5

**Spec:** `docs/superpowers/specs/2026-10-03-toil-buster-cli-design.md`

## Global Constraints

- 型チェックは `tsgo`（@typescript/native-preview ^7.0.0-dev、TypeScript 7系）。`npm run typecheck`
- Node.js 24（package.json `engines: ">=24.0.0"`、CI matrix 24）
- 追加依存は caret で固定: `commander@^15.0.0` `cli-table3@^0.6.5` `chalk@^6.0.1` `@aws-sdk/client-cloudwatch-logs@^3.1146.0`（zod ^4.3.6 はテンプレート既存）
- テストは src と同じ場所に共存 (`src/**/*.test.ts`)、ESM プロジェクトなので import は `./xxx.js` 形式
- `console.log` はコミット禁止（hook 警告対象）。出力は `io.stdout` / `process.stdout.write` を使う
- AWS 実環境への接続テストは禁止（SDK クライアントは必ずモック）
- シークレットのハードコード禁止。AWS 認証は標準 credential chain と `--profile` のみ
- カバレッジ 80% 以上（vitest thresholds。`src/cli/index.ts` の薄いエントリポイントは除外）
- GitHub Actions の `uses:` はコミットSHAピン留め（テンプレート踏襲。変更時も維持）
- コミットは Conventional Commits (`feat:` / `fix:` / `refactor:` / `test:` / `docs:` / `chore:`)
- デフォルト値: time=15m, level=ERROR, format=table, top=20, limit=1000

## Review Focus

spec が暗黙に想定するが個別タスクのテストだけでは拾いきれない、ユーザーを噛みやすい入力クラス。各自のテストは担当タスクに割り当て済み:

1. **不正な期間指定**（"10", "10x", "0m", ""）→ わかりやすいエラーメッセージ + exit 1。→ Task 2 の `parseDuration` エラーケース群 + Task 9 の `--time bad` E2E
2. **正規化ルールの境界衝突**（UUID vs 8桁以上hex vs 4桁以上数値、純粋数字列が `<hex>` にならないこと、IP 内数値）→ Task 3 の混在ケーステスト
3. **設定ファイルの破損・スキーマ違反・XDG パス**（不正 JSON、`aliases: 5`、XDG_CONFIG_HOME 指定）→ Task 5 の全テスト + Task 9 の broken-config で exit 1
4. **ページングと打ち切り**（nextToken 複数ページ、limit 到達で truncated、ThrottlingException が再試行上限を超えたら伝播）→ Task 7 のテスト群
5. **0 件・特殊文字・top 切り詰め**（0 件で正常終了、パターン内 `|` の md エスケープ、groups > top の切り詰め）→ Task 8 レンダラテスト + Task 9 の 0 件 exit 0

---

### Task 1: テンプレート取り込みと CLI スケルトン

**Files:**
- Create: `src/version.ts`, `src/cli/index.ts`, `src/cli/errors-command.ts`
- Test: `src/cli/errors-command.test.ts`
- Delete: `src/index.ts`, `src/index.test.ts`, `src/config/index.ts`, `.env.example`
- Modify: `package.json`, `tsup.config.ts`, `vitest.config.ts`, `.github/workflows/ci.yml`, `.github/workflows/ts-security.yml`
- 取り込み元: `https://github.com/y-maeda1116/ts-template-base`（README.md と docs/ を除く全ファイル）

**Interfaces:**
- Consumes: なし（最初のタスク）
- Produces: `runErrorsCommand(argv: string[], io: CliIo): Promise<number>` と `interface CliIo { stdout(text: string): void; stderr(text: string): void }`（src/cli/errors-command.ts。Task 9 が拡張）、`export const VERSION: string`（src/version.ts。ただし "0.1.0"）

- [ ] **Step 1: テンプレートをクローンしてファイル取り込み**

```bash
git clone --depth 1 https://github.com/y-maeda1116/ts-template-base /tmp/ts-template-base
rsync -a --exclude '.git' --exclude 'docs' --exclude 'README.md' /tmp/ts-template-base/ ./
```

取り込まれる主なファイル: `.github/`（SHA ピン留め済み workflows, dependabot, CODEOWNERS）、`.husky/`、`configs/`、`scripts/apply-security.sh`、`eslint.config.js`、`tsconfig.json`、`tsup.config.ts`、`vitest.config.ts`、`package.json`、`package-lock.json`、`.gitignore` ほか。既存の `README.md` と `docs/` は上書きしない。

- [ ] **Step 2: デモコード削除と依存整理**

```bash
rm src/index.ts src/index.test.ts src/config/index.ts .env.example
npm uninstall dotenv
npm install commander@^15.0.0 cli-table3@^0.6.5 chalk@^6.0.1 @aws-sdk/client-cloudwatch-logs@^3.1146.0
```

- [ ] **Step 3: package.json を編集**

変更点（`npm pkg set` を使うか直接編集）:

```bash
npm pkg set name="toil-buster-cli" version="0.1.0" description="Toil Buster CLI - CloudWatch Logs error extraction & statistics for SREs" engines.node=">=24.0.0"
```

- [ ] **Step 4: ビルド・テスト設定を修正**

`tsup.config.ts`:

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/cli/index.ts'],
  format: ['esm'],
  clean: true,
  sourcemap: true,
});
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/cli/index.ts', 'node_modules/'],
      thresholds: { global: { lines: 80, functions: 80, branches: 80, statements: 80 } },
    },
  },
});
```

`.github/workflows/ci.yml` の `node-version: [22]` を `node-version: [24]` へ、`.github/workflows/ts-security.yml` の `node-version: "22"` を `"24"` へ変更（`uses:` の SHA は触らない）。

- [ ] **Step 5: 失敗するテストを書く**

`src/cli/errors-command.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { runErrorsCommand, type CliIo } from './errors-command.js';

const makeIo = (): CliIo & { out: string[]; err: string[] } => {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
  };
};

describe('runErrorsCommand (skeleton)', () => {
  it('--help は終了コード 0 で usage を stdout に出す', async () => {
    const io = makeIo();
    const code = await runErrorsCommand(['--help'], io);
    expect(code).toBe(0);
    expect(io.out.join('')).toContain('tb');
  });

  it('--version はバージョン文字列を出す', async () => {
    const io = makeIo();
    const code = await runErrorsCommand(['--version'], io);
    expect(code).toBe(0);
    expect(io.out.join('')).toContain('0.1.0');
  });

  it('未知のオプションは 0 以外の終了コード', async () => {
    const io = makeIo();
    const code = await runErrorsCommand(['--bogus'], io);
    expect(code).not.toBe(0);
  });
});
```

- [ ] **Step 6: バージョン定数と CLI スケルトンを作成**

`src/version.ts`:

```ts
export const VERSION = '0.1.0';
```

`src/cli/errors-command.ts`:

```ts
import { Command, CommanderError } from 'commander';
import { VERSION } from '../version.js';

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

export async function runErrorsCommand(argv: string[], io: CliIo): Promise<number> {
  const program = new Command();
  program
    .name('tb')
    .description('Toil Buster - CloudWatch Logs エラー抽出・統計CLI')
    .version(VERSION);
  program.exitOverride();
  program.configureOutput({
    writeOut: (s) => io.stdout(s),
    writeErr: (s) => io.stderr(s),
  });
  try {
    await program.parseAsync(argv, { from: 'user' });
    return 0;
  } catch (err) {
    if (err instanceof CommanderError) return err.exitCode;
    throw err;
  }
}
```

※ `parseAsync` が投げるのは `exitOverride` 有効時は `CommanderError` だけ。それ以外の
エラーは上へ伝播させ、`src/cli/index.ts`（coverage 除外）で受け止める。

`src/cli/index.ts`:

```ts
import { runErrorsCommand } from './errors-command.js';

const io = {
  stdout: (text: string) => process.stdout.write(text),
  stderr: (text: string) => process.stderr.write(text),
};

void runErrorsCommand(process.argv.slice(2), io)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  });
```

- [ ] **Step 7: 全コマンドでグリーン確認**

Run: `npm run build && npm run lint && npm run typecheck && npm test`
Expected: すべて成功（3 tests passed。coverage 対象が version.ts/errors-command.ts のみで 80% 超え）

- [ ] **Step 8: コミット**

```bash
git add -A
git commit -m "feat: ts-template-base 骨組みを取り込み CLI スケルトンを追加"
```

---

### Task 2: parseDuration（期間パーサー）

**Files:**
- Create: `src/core/duration.ts`
- Test: `src/core/duration.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `export function parseDuration(input: string): number`（ミリ秒。不正入力は `Error`、message は `/Invalid duration/`）

- [ ] **Step 1: 失敗するテストを書く**

`src/core/duration.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseDuration } from './duration.js';

describe('parseDuration', () => {
  it.each([
    ['10s', 10_000],
    ['5m', 300_000],
    ['10m', 600_000],
    ['1h', 3_600_000],
    ['2d', 172_800_000],
  ])('%s をミリ秒へ変換する', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each(['abc', '10', '10x', 'm10', '', '1.5h'])('%s は Invalid duration エラー', (input) => {
    expect(() => parseDuration(input)).toThrow(/Invalid duration/);
  });

  it('0 や 00m のような 0 ミリ秒になる入力はエラー', () => {
    expect(() => parseDuration('0m')).toThrow(/Invalid duration/);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/core/duration.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 3: 実装**

`src/core/duration.ts`:

```ts
const DURATION_PATTERN = /^(\d+)([smhd])$/;

const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseDuration(input: string): number {
  const match = DURATION_PATTERN.exec(input);
  if (!match) {
    throw new Error(`Invalid duration: "${input}" (例: 10m, 1h, 2d)`);
  }
  const ms = Number(match[1]) * UNIT_MS[match[2]!]!;
  if (ms <= 0) {
    throw new Error(`Invalid duration: "${input}" (0 より大きい値を指定してください)`);
  }
  return ms;
}
```

- [ ] **Step 4: テスト通過を確認**

Run: `npx vitest run src/core/duration.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: コミット**

```bash
git add src/core/duration.ts src/core/duration.test.ts
git commit -m "feat: 期間指定パーサー parseDuration を追加"
```

---

### Task 3: normalizeMessage（メッセージ正規化）

**Files:**
- Create: `src/core/normalize.ts`
- Test: `src/core/normalize.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `export function normalizeMessage(message: string): string`（UUID/ISO時刻/IP/hex/4桁以上数値を `<uuid>` `<ts>` `<ip>` `<hex>` `<num>` へ置換）

- [ ] **Step 1: 失敗するテストを書く**

`src/core/normalize.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { normalizeMessage } from './normalize.js';

describe('normalizeMessage', () => {
  it('UUID を <uuid> にマスクする', () => {
    expect(normalizeMessage('Request 550e8400-e29b-41d4-a716-446655440000 failed')).toBe(
      'Request <uuid> failed',
    );
  });

  it('ISO8601 タイムスタンプを <ts> にマスクする（Z と +09:00 両方）', () => {
    expect(normalizeMessage('at 2026-10-03T01:23:45.678Z timeout')).toBe('at <ts> timeout');
    expect(normalizeMessage('at 2026-10-03T01:23:45+09:00 timeout')).toBe('at <ts> timeout');
  });

  it('IPv4 を <ip> にマスクする', () => {
    expect(normalizeMessage('connect 192.168.10.5 refused')).toBe('connect <ip> refused');
  });

  it('IPv6 形式も <ip> にマスクする', () => {
    expect(normalizeMessage('from 2001:db8::1 blocked')).toBe('from <ip> blocked');
  });

  it('0x prefix の hex と 8 文字以上の hex 列を <hex> にマスクする', () => {
    expect(normalizeMessage('digest 0xdeadbeef ok')).toBe('digest <hex> ok');
    expect(normalizeMessage('hash a1b2c3d4e5f6a7b8 done')).toBe('hash <hex> done');
  });

  it('純粋な数字列 (hex 文字を含まない) は <hex> にならず <num> になる', () => {
    expect(normalizeMessage('id 123456789 end')).toBe('id <num> end');
  });

  it('4 桁以上の数値は <num>、3 桁以下は保持する', () => {
    expect(normalizeMessage('port 8080 took 12345ms status=500 retries=3')).toBe(
      'port <num> took <num>ms status=500 retries=3',
    );
  });

  it('UUID は hex ルールより優先される', () => {
    expect(normalizeMessage('id=550e8400-e29b-41d4-a716-446655440000')).toBe('id=<uuid>');
  });

  it('複数種類が混在してもすべてマスクされる', () => {
    const input = 'user 550e8400-e29b-41d4-a716-446655440000 from 10.0.0.1 count 12345 digest 0xcafebabe at 2026-01-02T03:04:05Z';
    expect(normalizeMessage(input)).toBe(
      'user <uuid> from <ip> count <num> digest <hex> at <ts>',
    );
  });

  it('マスク対象がなければ元の文字列を返す', () => {
    expect(normalizeMessage('plain error message')).toBe('plain error message');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/core/normalize.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 3: 実装**

`src/core/normalize.ts`:

```ts
// 適用順序が重要: UUID → 時刻 → IP → hex → 数値
// (先にマスクされたプレースホルダは後続ルールの入力にならない)
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>'],
  [/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})\b/g, '<ts>'],
  [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>'],
  [/\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{0,4}\b/gi, '<ip>'],
  [/\b0x[0-9a-f]+\b/gi, '<hex>'],
  [/\b(?=[0-9a-f]*[a-f])[0-9a-f]{8,}\b/gi, '<hex>'],
  [/\b\d{4,}\b/g, '<num>'],
];

export function normalizeMessage(message: string): string {
  return RULES.reduce((acc, [pattern, token]) => acc.replace(pattern, token), message);
}
```

- [ ] **Step 4: テスト通過を確認**

Run: `npx vitest run src/core/normalize.test.ts`
Expected: PASS（全ケース。失敗したら正規表現の順序・先読みを確認）

- [ ] **Step 5: コミット**

```bash
git add src/core/normalize.ts src/core/normalize.test.ts
git commit -m "feat: ログメッセージ正規化 normalizeMessage を追加"
```

---

### Task 4: providers/types.ts と aggregateEvents（集計）

**Files:**
- Create: `src/providers/types.ts`, `src/core/aggregate.ts`
- Test: `src/core/aggregate.test.ts`

**Interfaces:**
- Consumes: `normalizeMessage`（Task 3）
- Produces:
  - `src/providers/types.ts`: `interface LogEvent { timestamp: Date; message: string }`、`interface LogQuery { logGroup: string; startTime: Date; endTime: Date; filterPattern: string; limit: number }`、`interface FetchResult { events: LogEvent[]; truncated: boolean }`、`interface LogProvider { fetch(query: LogQuery): Promise<FetchResult> }`
  - `src/core/aggregate.ts`: `interface ErrorGroupStats { pattern: string; count: number; firstSeen: Date; lastSeen: Date; sample: string }`、`interface SummaryResult { logGroup: string; timeWindow: { start: Date; end: Date }; totalEvents: number; truncated: boolean; groups: ErrorGroupStats[] }`、`export function aggregateEvents(logGroup: string, start: Date, end: Date, events: readonly LogEvent[], truncated: boolean): SummaryResult`

- [ ] **Step 1: 共通型を作成**

`src/providers/types.ts`:

```ts
export interface LogEvent {
  timestamp: Date;
  message: string;
}

export interface LogQuery {
  logGroup: string;
  startTime: Date;
  endTime: Date;
  filterPattern: string;
  limit: number;
}

export interface FetchResult {
  events: LogEvent[];
  truncated: boolean;
}

export interface LogProvider {
  fetch(query: LogQuery): Promise<FetchResult>;
}
```

- [ ] **Step 2: 失敗するテストを書く**

`src/core/aggregate.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { aggregateEvents } from './aggregate.js';
import type { LogEvent } from '../providers/types.js';

const event = (timestamp: string, message: string): LogEvent => ({
  timestamp: new Date(timestamp),
  message,
});

describe('aggregateEvents', () => {
  const start = new Date('2026-10-03T09:00:00Z');
  const end = new Date('2026-10-03T09:15:00Z');

  it('同じパターン（正規化後）は 1 グループに集計し count/firstSeen/lastSeen/sample を持つ', () => {
    const events = [
      event('2026-10-03T09:01:00Z', 'timeout id=1111'),
      event('2026-10-03T09:05:00Z', 'timeout id=2222'),
      event('2026-10-03T09:03:00Z', 'timeout id=3333'),
    ];
    const result = aggregateEvents('/g', start, end, events, false);
    expect(result.groups).toHaveLength(1);
    const group = result.groups[0]!;
    expect(group.pattern).toBe('timeout id=<num>');
    expect(group.count).toBe(3);
    expect(group.firstSeen).toEqual(new Date('2026-10-03T09:01:00Z'));
    expect(group.lastSeen).toEqual(new Date('2026-10-03T09:05:00Z'));
    expect(group.sample).toBe('timeout id=1111');
  });

  it('異なるパターンは別グループになり count 降順でソートされる', () => {
    const events = [
      event('2026-10-03T09:01:00Z', 'error A'),
      event('2026-10-03T09:02:00Z', 'error B'),
      event('2026-10-03T09:03:00Z', 'error B'),
    ];
    const result = aggregateEvents('/g', start, end, events, false);
    expect(result.groups.map((g) => g.pattern)).toEqual(['error B', 'error A']);
  });

  it('totalEvents / timeWindow / truncated / logGroup を保持する', () => {
    const result = aggregateEvents('/my-group', start, end, [event('2026-10-03T09:01:00Z', 'x')], true);
    expect(result.totalEvents).toBe(1);
    expect(result.timeWindow).toEqual({ start, end });
    expect(result.truncated).toBe(true);
    expect(result.logGroup).toBe('/my-group');
  });

  it('空配列なら groups も空', () => {
    const result = aggregateEvents('/g', start, end, [], false);
    expect(result.groups).toEqual([]);
    expect(result.totalEvents).toBe(0);
  });
});
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npx vitest run src/core/aggregate.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 4: 実装**

`src/core/aggregate.ts`:

```ts
import type { LogEvent } from '../providers/types.js';
import { normalizeMessage } from './normalize.js';

export interface ErrorGroupStats {
  pattern: string;
  count: number;
  firstSeen: Date;
  lastSeen: Date;
  sample: string;
}

export interface SummaryResult {
  logGroup: string;
  timeWindow: { start: Date; end: Date };
  totalEvents: number;
  truncated: boolean;
  groups: ErrorGroupStats[];
}

export function aggregateEvents(
  logGroup: string,
  start: Date,
  end: Date,
  events: readonly LogEvent[],
  truncated: boolean,
): SummaryResult {
  const groups = new Map<string, ErrorGroupStats>();
  for (const e of events) {
    const pattern = normalizeMessage(e.message);
    const current = groups.get(pattern);
    const next: ErrorGroupStats = current
      ? {
          ...current,
          count: current.count + 1,
          firstSeen: e.timestamp < current.firstSeen ? e.timestamp : current.firstSeen,
          lastSeen: e.timestamp > current.lastSeen ? e.timestamp : current.lastSeen,
        }
      : { pattern, count: 1, firstSeen: e.timestamp, lastSeen: e.timestamp, sample: e.message };
    groups.set(pattern, next);
  }
  return {
    logGroup,
    timeWindow: { start, end },
    totalEvents: events.length,
    truncated,
    groups: [...groups.values()].sort((a, b) => b.count - a.count),
  };
}
```

- [ ] **Step 5: テスト通過を確認**

Run: `npx vitest run src/core/aggregate.test.ts`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add src/providers/types.ts src/core/aggregate.ts src/core/aggregate.test.ts
git commit -m "feat: イベント集計 aggregateEvents と LogProvider 型を追加"
```

---

### Task 5: 設定ファイル読み込みとエイリアス解決

**Files:**
- Create: `src/config/load.ts`
- Test: `src/config/load.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `export interface AppConfig { aliases: Record<string, string>; defaults: { region?: string; time?: string; format?: 'table' | 'json' | 'md'; profile?: string; top?: number; limit?: number } }`
  - `export function configFilePath(env: { XDG_CONFIG_HOME?: string; HOME?: string }): string`
  - `export function loadConfig(env: { XDG_CONFIG_HOME?: string; HOME?: string }): AppConfig`（ファイルなし → デフォルト。破損 JSON / スキーマ違反は `Error` throw）
  - `export function resolveGroupName(name: string, aliases: Record<string, string>): string`

- [ ] **Step 1: 失敗するテストを書く**

`src/config/load.test.ts`:

```ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { configFilePath, loadConfig, resolveGroupName } from './load.js';

const dirs: string[] = [];
const withConfig = (content: string): { XDG_CONFIG_HOME: string; HOME: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'tb-config-'));
  dirs.push(dir);
  const xdg = join(dir, 'xdg');
  mkdirSync(join(xdg, 'toil-buster'), { recursive: true });
  writeFileSync(join(xdg, 'toil-buster', 'config.json'), content);
  return { XDG_CONFIG_HOME: xdg, HOME: join(dir, 'home') };
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('configFilePath', () => {
  it('XDG_CONFIG_HOME 指定時はその直下', () => {
    expect(configFilePath({ XDG_CONFIG_HOME: '/xdg', HOME: '/home' })).toBe(
      '/xdg/toil-buster/config.json',
    );
  });
  it('未指定時は HOME/.config 配下', () => {
    expect(configFilePath({ HOME: '/home' })).toBe('/home/.config/toil-buster/config.json');
  });
});

describe('loadConfig', () => {
  it('ファイルがなければデフォルト設定を返す', () => {
    const env = { XDG_CONFIG_HOME: '/nonexistent-tb', HOME: '/nonexistent-tb' };
    expect(loadConfig(env)).toEqual({ aliases: {}, defaults: {} });
  });

  it('有効な設定を読み込む', () => {
    const env = withConfig(
      JSON.stringify({
        aliases: { 'prod-api': '/aws/lambda/prod-api' },
        defaults: { region: 'ap-northeast-1', time: '30m', format: 'json' },
      }),
    );
    expect(loadConfig(env)).toEqual({
      aliases: { 'prod-api': '/aws/lambda/prod-api' },
      defaults: { region: 'ap-northeast-1', time: '30m', format: 'json' },
    });
  });

  it('壊れた JSON はエラー', () => {
    const env = withConfig('{ not json');
    expect(() => loadConfig(env)).toThrow(/設定ファイル/);
  });

  it('スキーマ違反 (aliases が数値) はエラー', () => {
    const env = withConfig(JSON.stringify({ aliases: 5 }));
    expect(() => loadConfig(env)).toThrow(/設定ファイル/);
  });

  it('defaults の部分的な指定も許容する', () => {
    const env = withConfig(JSON.stringify({ defaults: { top: 5 } }));
    expect(loadConfig(env).defaults).toEqual({ top: 5 });
  });
});

describe('resolveGroupName', () => {
  it('エイリアスを解決する', () => {
    expect(resolveGroupName('prod-api', { 'prod-api': '/aws/lambda/prod-api' })).toBe(
      '/aws/lambda/prod-api',
    );
  });
  it('未登録の名前はそのまま返す', () => {
    expect(resolveGroupName('/aws/lambda/other', { 'prod-api': '/aws/lambda/prod-api' })).toBe(
      '/aws/lambda/other',
    );
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/config/load.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 3: 実装**

`src/config/load.ts`:

```ts
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const configSchema = z.object({
  aliases: z.record(z.string(), z.string()).default({}),
  defaults: z
    .object({
      region: z.string().optional(),
      time: z.string().optional(),
      format: z.enum(['table', 'json', 'md']).optional(),
      profile: z.string().optional(),
      top: z.number().int().positive().optional(),
      limit: z.number().int().positive().optional(),
    })
    .default({}),
});

export type AppConfig = z.infer<typeof configSchema>;

export interface ConfigEnv {
  XDG_CONFIG_HOME?: string;
  HOME?: string;
}

export function configFilePath(env: ConfigEnv): string {
  const base = env.XDG_CONFIG_HOME ?? `${env.HOME ?? ''}/.config`;
  return `${base}/toil-buster/config.json`;
}

export function loadConfig(env: ConfigEnv): AppConfig {
  const path = configFilePath(env);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { aliases: {}, defaults: {} };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`設定ファイルのJSONが不正です: ${path}`, { cause });
  }
  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`設定ファイルの形式が不正です: ${path}`);
  }
  return result.data;
}

export function resolveGroupName(name: string, aliases: Record<string, string>): string {
  return aliases[name] ?? name;
}
```

- [ ] **Step 4: テスト通過を確認**

Run: `npx vitest run src/config/load.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/config/load.ts src/config/load.test.ts
git commit -m "feat: 設定ファイル読み込みとエイリアス解決を追加"
```

---

### Task 6: buildFilterPattern（CloudWatch フィルタ生成）

**Files:**
- Create: `src/cli/filter-pattern.ts`
- Test: `src/cli/filter-pattern.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `export function buildFilterPattern(levels: readonly string[]): string`（`?ERROR ?Error ?error` 形式。空の場合は `Error` throw）

- [ ] **Step 1: 失敗するテストを書く**

`src/cli/filter-pattern.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildFilterPattern } from './filter-pattern.js';

describe('buildFilterPattern', () => {
  it('ERROR は大文字/先頭大文字/小文字の 3 タームを OR 結合する', () => {
    expect(buildFilterPattern(['ERROR'])).toBe('?ERROR ?Error ?error');
  });

  it('複数レベルはすべてのタームを並べる', () => {
    expect(buildFilterPattern(['warn', 'error'])).toBe('?WARN ?Warn ?warn ?ERROR ?Error ?error');
  });

  it('大文字小文字違いの重複入力は dedupe される', () => {
    expect(buildFilterPattern(['error', 'ERROR'])).toBe('?ERROR ?Error ?error');
  });

  it('空配列や空文字のみはエラー', () => {
    expect(() => buildFilterPattern([])).toThrow(/レベル/);
    expect(() => buildFilterPattern(['', ' '])).toThrow(/レベル/);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/cli/filter-pattern.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 3: 実装**

`src/cli/filter-pattern.ts`:

```ts
export function buildFilterPattern(levels: readonly string[]): string {
  const terms = new Set<string>();
  for (const raw of levels) {
    const level = raw.trim().toLowerCase();
    if (!level) continue;
    terms.add(level.toUpperCase());
    terms.add(level.charAt(0).toUpperCase() + level.slice(1));
    terms.add(level);
  }
  if (terms.size === 0) {
    throw new Error('レベルが指定されていません (--level WARN,ERROR の形式で指定してください)');
  }
  return [...terms].map((t) => `?${t}`).join(' ');
}
```

- [ ] **Step 4: テスト通過を確認**

Run: `npx vitest run src/cli/filter-pattern.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/cli/filter-pattern.ts src/cli/filter-pattern.test.ts
git commit -m "feat: CloudWatch タームフィルタパターン生成を追加"
```

---

### Task 7: CloudWatchProvider（ページング・再試行）

**Files:**
- Create: `src/providers/cloudwatch.ts`
- Test: `src/providers/cloudwatch.test.ts`

**Interfaces:**
- Consumes: `LogProvider`, `LogQuery`, `FetchResult`, `LogEvent`（Task 4）
- Produces:
  - `export type Sender = { send(command: FilterLogEventsCommand): Promise<FilterLogEventsCommandOutput> }`（構造的型。`CloudWatchLogsClient` の `send` はこの形状を満たす — Command インスタンスを受け取る点に注意）
  - `export class CloudWatchProvider implements LogProvider`、`constructor(sender: Sender, opts?: { retryDelayMs?: number; maxRetries?: number })`、`fetch(query: LogQuery): Promise<FetchResult>`

- [ ] **Step 1: 失敗するテストを書く**

`src/providers/cloudwatch.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { FilterLogEventsCommand, type FilterLogEventsCommandOutput } from '@aws-sdk/client-cloudwatch-logs';
import { CloudWatchProvider } from './cloudwatch.js';
import type { LogQuery } from './types.js';

type Send = (command: FilterLogEventsCommand) => Promise<FilterLogEventsCommandOutput>;

const query = (limit: number): LogQuery => ({
  logGroup: '/g',
  startTime: new Date('2026-10-03T09:00:00Z'),
  endTime: new Date('2026-10-03T09:15:00Z'),
  filterPattern: '?ERROR',
  limit,
});

const page = (messages: string[], nextToken?: string): FilterLogEventsCommandOutput => ({
  events: messages.map((m, i) => ({ messageId: `${i}`, timestamp: Date.parse('2026-10-03T09:01:00Z'), message: m })),
  nextToken,
});

describe('CloudWatchProvider', () => {
  it('1 ページを LogEvent に変換して返す', async () => {
    const send = vi.fn<Send>()
      .mockResolvedValue(page(['error one', 'error two']));
    const provider = new CloudWatchProvider(send, { retryDelayMs: 0 });
    const result = await provider.fetch(query(100));
    expect(result.events.map((e) => e.message)).toEqual(['error one', 'error two']);
    expect(result.events[0]!.timestamp).toEqual(new Date('2026-10-03T09:01:00Z'));
    expect(result.truncated).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]![0].input).toMatchObject({
      logGroupName: '/g',
      filterPattern: '?ERROR',
      startTime: Date.parse('2026-10-03T09:00:00Z'),
    });
  });

  it('nextToken がある限りページングする', async () => {
    const send = vi.fn<Send>()
      .mockResolvedValueOnce(page(['a'], 'token-1'))
      .mockResolvedValueOnce(page(['b'], undefined));
    const provider = new CloudWatchProvider(send, { retryDelayMs: 0 });
    const result = await provider.fetch(query(100));
    expect(result.events.map((e) => e.message)).toEqual(['a', 'b']);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![0].input.nextToken).toBe('token-1');
  });

  it('limit 到達で打ち切り truncated=true', async () => {
    const send = vi.fn<Send>()
      .mockResolvedValue(page(['a', 'b', 'c'], 'token-1'));
    const provider = new CloudWatchProvider(send, { retryDelayMs: 0 });
    const result = await provider.fetch(query(2));
    expect(result.events).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it('ThrottlingException は指数バックオフで再試行する', async () => {
    const throttled = Object.assign(new Error('throttled'), { name: 'ThrottlingException' });
    const send = vi.fn<Send>()
      .mockRejectedValueOnce(throttled)
      .mockResolvedValueOnce(page(['ok']));
    const provider = new CloudWatchProvider(send, { retryDelayMs: 1 });
    const result = await provider.fetch(query(100));
    expect(result.events.map((e) => e.message)).toEqual(['ok']);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('再試行上限を超えた ThrottlingException は伝播する', async () => {
    const throttled = Object.assign(new Error('throttled'), { name: 'ThrottlingException' });
    const send = vi.fn<(input: FilterLogEventsCommandInput) => Promise<FilterLogEventsCommandOutput>>>()
      .mockRejectedValue(throttled);
    const provider = new CloudWatchProvider(send, { retryDelayMs: 0, maxRetries: 2 });
    await expect(provider.fetch(query(100))).rejects.toThrow(/throttled/);
    expect(send).toHaveBeenCalledTimes(3); // 初回 + 再試行2回
  });

  it('ThrottlingException 以外は即座に伝播する', async () => {
    const notFound = Object.assign(new Error('missing'), { name: 'ResourceNotFoundException' });
    const send = vi.fn<Send>()
      .mockRejectedValue(notFound);
    const provider = new CloudWatchProvider(send, { retryDelayMs: 0 });
    await expect(provider.fetch(query(100))).rejects.toThrow(/missing/);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/providers/cloudwatch.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 3: 実装**

`src/providers/cloudwatch.ts`:

```ts
import { FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import type { FilterLogEventsCommandInput, FilterLogEventsCommandOutput } from '@aws-sdk/client-cloudwatch-logs';
import type { FetchResult, LogProvider, LogQuery } from './types.js';

// CloudWatchLogsClient の send は Command インスタンスを受け取る。
// この構造的型を満たすモックでテストする。
export type Sender = {
  send(command: FilterLogEventsCommand): Promise<FilterLogEventsCommandOutput>;
};

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class CloudWatchProvider implements LogProvider {
  constructor(
    private readonly sender: Sender,
    private readonly opts: { retryDelayMs?: number; maxRetries?: number } = {},
  ) {}

  async fetch(query: LogQuery): Promise<FetchResult> {
    const { retryDelayMs = 500, maxRetries = 3 } = this.opts;
    const events = [];
    let truncated = false;
    let nextToken: string | undefined;
    do {
      const input: FilterLogEventsCommandInput = {
        logGroupName: query.logGroup,
        startTime: query.startTime.getTime(),
        endTime: query.endTime.getTime(),
        filterPattern: query.filterPattern,
        nextToken,
      };
      const output = await this.sendWithRetry(new FilterLogEventsCommand(input), retryDelayMs, maxRetries);
      for (const e of output.events ?? []) {
        if (events.length >= query.limit) {
          truncated = true;
          break;
        }
        events.push({ timestamp: new Date(e.timestamp ?? 0), message: e.message ?? '' });
      }
      if (truncated) break;
      nextToken = output.nextToken;
    } while (nextToken !== undefined);
    return { events, truncated };
  }

  private async sendWithRetry(
    command: FilterLogEventsCommand,
    retryDelayMs: number,
    maxRetries: number,
  ): Promise<FilterLogEventsCommandOutput> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.sender.send(command);
      } catch (err) {
        if ((err as { name?: string }).name === 'ThrottlingException' && attempt < maxRetries) {
          await delay(retryDelayMs * 2 ** attempt);
          continue;
        }
        throw err;
      }
    }
  }
}

```

※ 実運用では `new CloudWatchProvider(new CloudWatchLogsClient({ region, profile }))` として使う（Task 9）。
`CloudWatchLogsClient` の `send` はジェネリックだがメソッド引数の bivariance により
`Sender` に構造的に代入可能。Task 9 の `defaultProviderFactory` で型チェックが実証される。

- [ ] **Step 4: テスト通過を確認**

Run: `npx vitest run src/providers/cloudwatch.test.ts`
Expected: PASS（6 tests）

- [ ] **Step 5: コミット**

```bash
git add src/providers/cloudwatch.ts src/providers/cloudwatch.test.ts
git commit -m "feat: CloudWatchProvider (FilterLogEvents ページング・再試行) を追加"
```

---

### Task 8: レンダラ（table / json / markdown）

**Files:**
- Create: `src/render/format.ts`, `src/render/table.ts`, `src/render/json.ts`, `src/render/markdown.ts`
- Test: `src/render/table.test.ts`, `src/render/json.test.ts`, `src/render/markdown.test.ts`

**Interfaces:**
- Consumes: `SummaryResult`（Task 4）
- Produces:
  - `src/render/format.ts`: `export function formatTime(date: Date): string`（`HH:MM:SS`）、`export function formatWindow(start: Date, end: Date): string`（`YYYY-MM-DD HH:MM:SS 〜 HH:MM:SS`）
  - 各レンダラ: `export function renderTable(result: SummaryResult, top: number): string` / `renderJson` / `renderMarkdown`（同じシグネチャ。top で groups を切り詰める。0 件時は「該当時間帯にエラーは見つかりませんでした」を含む文字列）

- [ ] **Step 1: 失敗するテストを書く（3 ファイル）**

`src/render/table.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { SummaryResult } from '../core/aggregate.js';
import { renderTable } from './table.js';

const result = (groups: SummaryResult['groups'], totalEvents = groups.reduce((s, g) => s + g.count, 0)): SummaryResult => ({
  logGroup: '/aws/lambda/prod-api',
  timeWindow: { start: new Date('2026-10-03T09:00:00Z'), end: new Date('2026-10-03T09:15:00Z') },
  totalEvents,
  truncated: false,
  groups,
});

const group = (pattern: string, count: number) => ({
  pattern,
  count,
  firstSeen: new Date('2026-10-03T09:01:00Z'),
  lastSeen: new Date('2026-10-03T09:05:00Z'),
  sample: pattern,
});

describe('renderTable', () => {
  it('ヘッダー情報とランキング行を含む', () => {
    const out = renderTable(result([group('timeout <num>', 3), group('connect <ip>', 1)]), 20);
    expect(out).toContain('/aws/lambda/prod-api');
    expect(out).toContain('timeout <num>');
    expect(out).toContain('connect <ip>');
    expect(out.indexOf('timeout <num>')).toBeLessThan(out.indexOf('connect <ip>'));
  });

  it('top で行数を切り詰める', () => {
    const out = renderTable(result([group('a', 2), group('b', 1)]), 1);
    expect(out).toContain('a');
    expect(out).not.toContain(' b ');
  });

  it('0 件はメッセージのみ', () => {
    const out = renderTable(result([]), 20);
    expect(out).toContain('該当時間帯にエラーは見つかりませんでした');
  });

  it('truncated=true は警告行を含む', () => {
    const r = { ...result([group('a', 1)]), truncated: true };
    expect(renderTable(r, 20)).toContain('--limit');
  });
});
```

`src/render/json.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { SummaryResult } from '../core/aggregate.js';
import { renderJson } from './json.js';

const base: SummaryResult = {
  logGroup: '/g',
  timeWindow: { start: new Date('2026-10-03T09:00:00Z'), end: new Date('2026-10-03T09:15:00Z') },
  totalEvents: 2,
  truncated: false,
  groups: [
    {
      pattern: 'timeout <num>',
      count: 2,
      firstSeen: new Date('2026-10-03T09:01:00Z'),
      lastSeen: new Date('2026-10-03T09:05:00Z'),
      sample: 'timeout 1234',
    },
  ],
};

describe('renderJson', () => {
  it('JSON としてパースでき、時刻は ISO 文字列', () => {
    const parsed = JSON.parse(renderJson(base, 20));
    expect(parsed.logGroup).toBe('/g');
    expect(parsed.groups[0].pattern).toBe('timeout <num>');
    expect(parsed.timeWindow.start).toBe('2026-10-03T09:00:00.000Z');
    expect(parsed.groups[0].firstSeen).toBe('2026-10-03T09:01:00.000Z');
  });

  it('top で groups を切り詰める / 0 件も有効な JSON', () => {
    const two = { ...base, groups: [...base.groups, { ...base.groups[0]!, pattern: 'x', count: 1 }] };
    expect(JSON.parse(renderJson(two, 1)).groups).toHaveLength(1);
    const empty = { ...base, groups: [], totalEvents: 0 };
    expect(JSON.parse(renderJson(empty, 20)).groups).toEqual([]);
  });
});
```

`src/render/markdown.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { SummaryResult } from '../core/aggregate.js';
import { renderMarkdown } from './markdown.js';

const base: SummaryResult = {
  logGroup: '/g',
  timeWindow: { start: new Date('2026-10-03T09:00:00Z'), end: new Date('2026-10-03T09:15:00Z') },
  totalEvents: 1,
  truncated: false,
  groups: [
    {
      pattern: 'pipe | inside',
      count: 1,
      firstSeen: new Date('2026-10-03T09:01:00Z'),
      lastSeen: new Date('2026-10-03T09:05:00Z'),
      sample: 'pipe | inside',
    },
  ],
};

describe('renderMarkdown', () => {
  it('md テーブル行を含み、パターン内の | はエスケープされる', () => {
    const out = renderMarkdown(base, 20);
    expect(out).toContain('| # |');
    expect(out).toContain('pipe \\| inside');
    expect(out).not.toContain('pipe | inside');
  });

  it('0 件はメッセージのみでテーブル行を持たない', () => {
    const out = renderMarkdown({ ...base, groups: [], totalEvents: 0 }, 20);
    expect(out).toContain('該当時間帯にエラーは見つかりませんでした');
    expect(out).not.toContain('| # |');
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/render/`
Expected: FAIL（module not found）

- [ ] **Step 3: 実装（4 ファイル）**

`src/render/format.ts`:

```ts
const pad = (n: number) => String(n).padStart(2, '0');

export function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatWindow(start: Date, end: Date): string {
  const d = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  return `${d} ${formatTime(start)} 〜 ${formatTime(end)}`;
}
```

`src/render/json.ts`:

```ts
import type { SummaryResult } from '../core/aggregate.js';

const EMPTY_MESSAGE = '該当時間帯にエラーは見つかりませんでした';

export function renderJson(result: SummaryResult, top: number): string {
  if (result.groups.length === 0) {
    return `${JSON.stringify({ ...result, groups: [], message: EMPTY_MESSAGE }, null, 2)}\n`;
  }
  return `${JSON.stringify({ ...result, groups: result.groups.slice(0, top) }, null, 2)}\n`;
}
```

※ `JSON.stringify` は Date を ISO 文字列へ自動変換するため追加変換不要。

`src/render/table.ts`:

```ts
import chalk from 'chalk';
import Table from 'cli-table3';
import type { SummaryResult } from '../core/aggregate.js';
import { formatTime, formatWindow } from './format.js';

const EMPTY_MESSAGE = '該当時間帯にエラーは見つかりませんでした';
const PATTERN_MAX = 80;

export function renderTable(result: SummaryResult, top: number): string {
  if (result.groups.length === 0) return `${EMPTY_MESSAGE}\n`;
  const table = new Table({
    head: ['#', 'COUNT', '%', 'FIRST', 'LAST', 'PATTERN'].map((h) => chalk.bold(h)),
  });
  for (const [i, g] of result.groups.slice(0, top).entries()) {
    const pct = ((g.count / result.totalEvents) * 100).toFixed(1);
    const pattern = g.pattern.length > PATTERN_MAX ? `${g.pattern.slice(0, PATTERN_MAX)}…` : g.pattern;
    table.push([i + 1, g.count, pct, formatTime(g.firstSeen), formatTime(g.lastSeen), pattern]);
  }
  const lines = [
    chalk.bold(`Log Group: ${result.logGroup}`),
    `Window: ${formatWindow(result.timeWindow.start, result.timeWindow.end)}  Events: ${result.totalEvents}`,
  ];
  if (result.truncated) lines.push(chalk.yellow('⚠ --limit に達したため結果を打ち切りました'));
  lines.push(table.toString());
  return `${lines.join('\n')}\n`;
}
```

`src/render/markdown.ts`:

```ts
import type { SummaryResult } from '../core/aggregate.js';
import { formatWindow } from './format.js';

const EMPTY_MESSAGE = '該当時間帯にエラーは見つかりませんでした';
const escapeCell = (text: string) => text.replace(/\|/g, '\\|');

export function renderMarkdown(result: SummaryResult, top: number): string {
  if (result.groups.length === 0) return `${EMPTY_MESSAGE}\n`;
  const lines = [
    `# Log Summary: ${result.logGroup}`,
    '',
    `- 期間: ${formatWindow(result.timeWindow.start, result.timeWindow.end)}`,
    `- イベント数: ${result.totalEvents}${result.truncated ? '（--limit により打ち切り）' : ''}`,
    '',
    '| # | count | % | pattern | first | last |',
    '|---|---|---|---|---|---|',
  ];
  for (const [i, g] of result.groups.slice(0, top).entries()) {
    const pct = ((g.count / result.totalEvents) * 100).toFixed(1);
    const hhmmss = (d: Date) => d.toTimeString().slice(0, 8);
    lines.push(
      `| ${i + 1} | ${g.count} | ${pct}% | \`${escapeCell(g.pattern)}\` | ${hhmmss(g.firstSeen)} | ${hhmmss(g.lastSeen)} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}
```

- [ ] **Step 4: テスト通過を確認**

Run: `npx vitest run src/render/`
Expected: PASS（table 4 + json 2 + markdown 2）

- [ ] **Step 5: コミット**

```bash
git add src/render/
git commit -m "feat: table/json/markdown レンダラを追加"
```

---

### Task 9: errors コマンド本体（ワイヤリング・エラー分類）

**Files:**
- Modify: `src/cli/errors-command.ts`（Task 1 のスケルトンを全面拡張）
- Test: `src/cli/errors-command.test.ts`（Task 1 のテストに追記）

**Interfaces:**
- Consumes: `loadConfig` / `resolveGroupName`（Task 5）、`parseDuration`（Task 2）、`aggregateEvents`（Task 4）、`buildFilterPattern`（Task 6）、`CloudWatchProvider`（Task 7）、3 レンダラ（Task 8）
- Produces: `runErrorsCommand(argv: string[], io: CliIo, deps?: Partial<RunDeps>): Promise<number>`、`export interface RunDeps { providerFactory(opts: { region?: string; profile?: string }): LogProvider; env: NodeJS.ProcessEnv; now(): Date }`

- [ ] **Step 1: 失敗するテストを追記する**

`src/cli/errors-command.test.ts` に追記（既存のスケルトンテストはそのまま）:

```ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runErrorsCommand, type CliIo, type RunDeps } from './errors-command.js';
import type { FetchResult, LogProvider, LogQuery } from '../providers/types.js';

const makeIo = (): CliIo & { out: string[]; err: string[] } => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (t) => out.push(t), stderr: (t) => err.push(t) };
};

const NOW = new Date('2026-10-03T10:00:00Z');
const dirs: string[] = [];
const withConfig = (content: string) => {
  const dir = mkdtempSync(join(tmpdir(), 'tb-cli-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'toil-buster'), { recursive: true });
  writeFileSync(join(dir, 'toil-buster', 'config.json'), content);
  return { XDG_CONFIG_HOME: dir, HOME: dir };
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const okResult: FetchResult = {
  events: [
    { timestamp: new Date('2026-10-03T09:55:00Z'), message: 'timeout id=1111' },
    { timestamp: new Date('2026-10-03T09:58:00Z'), message: 'timeout id=2222' },
  ],
  truncated: false,
};

const makeDeps = (provider: LogProvider, env: NodeJS.ProcessEnv = { HOME: '/tmp' }): Partial<RunDeps> => ({
  providerFactory: () => provider,
  env,
  now: () => NOW,
});

describe('runErrorsCommand: errors', () => {
  it('デフォルトで 15m 窓・ERROR タームフィルタ・limit 1000 でクエリし、table 出力する', async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(okResult);
    const io = makeIo();
    const code = await runErrorsCommand(['errors', 'prod-api'], io, makeDeps({ fetch }));
    expect(code).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    const q = fetch.mock.calls[0]![0];
    expect(q.logGroup).toBe('prod-api');
    expect(q.filterPattern).toBe('?ERROR ?Error ?error');
    expect(q.limit).toBe(1000);
    expect(q.startTime.getTime()).toBe(NOW.getTime() - 15 * 60_000);
    expect(io.out.join('')).toContain('timeout <num>');
    expect(io.out.join('')).toContain('2');
  });

  it('--time 10m と設定のエイリアス/defaults が反映される', async () => {
    const env = withConfig(
      JSON.stringify({ aliases: { 'prod-api': '/aws/lambda/prod-api' }, defaults: { top: 1 } }),
    );
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(okResult);
    const io = makeIo();
    const code = await runErrorsCommand(
      ['errors', 'prod-api', '--time', '10m'],
      io,
      makeDeps({ fetch }, env),
    );
    expect(code).toBe(0);
    expect(fetch.mock.calls[0]![0].logGroup).toBe('/aws/lambda/prod-api');
    expect(fetch.mock.calls[0]![0].startTime.getTime()).toBe(NOW.getTime() - 600_000);
  });

  it('--format json はパース可能な JSON を stdout へ', async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(okResult);
    const io = makeIo();
    await runErrorsCommand(['errors', 'g', '--format', 'json'], io, makeDeps({ fetch }));
    const parsed = JSON.parse(io.out.join(''));
    expect(parsed.groups[0].pattern).toBe('timeout <num>');
    expect(parsed.groups[0].count).toBe(2);
  });

  it('--format json の実行時エラーは構造化して stderr へ、exit 1', async () => {
    const notFound = Object.assign(new Error('missing'), { name: 'ResourceNotFoundException' });
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockRejectedValue(notFound);
    const io = makeIo();
    const code = await runErrorsCommand(['errors', 'g', '--format', 'json'], io, makeDeps({ fetch }));
    expect(code).toBe(1);
    expect(JSON.parse(io.err.join('')).error).toContain('ロググループ');
  });

  it('ResourceNotFoundException はグループ確認のガイドを出す', async () => {
    const notFound = Object.assign(new Error('missing'), { name: 'ResourceNotFoundException' });
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockRejectedValue(notFound);
    const io = makeIo();
    const code = await runErrorsCommand(['errors', 'g'], io, makeDeps({ fetch }));
    expect(code).toBe(1);
    expect(io.err.join('')).toContain('ロググループが見つかりません');
  });

  it('AWS 認証系エラーは --profile のガイドを出す', async () => {
    const authErr = Object.assign(new Error('creds'), { name: 'CredentialsProviderError' });
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockRejectedValue(authErr);
    const io = makeIo();
    const code = await runErrorsCommand(['errors', 'g'], io, makeDeps({ fetch }));
    expect(code).toBe(1);
    expect(io.err.join('')).toContain('--profile');
  });

  it('不正な --time は exit 1 で Invalid duration', async () => {
    const io = makeIo();
    const code = await runErrorsCommand(['errors', 'g', '--time', 'bad'], io, makeDeps({ fetch: vi.fn() }));
    expect(code).toBe(1);
    expect(io.err.join('')).toContain('Invalid duration');
  });

  it('破損した設定ファイルは exit 1', async () => {
    const env = withConfig('{ broken');
    const io = makeIo();
    const code = await runErrorsCommand(['errors', 'g'], io, makeDeps({ fetch: vi.fn() }, env));
    expect(code).toBe(1);
    expect(io.err.join('')).toContain('設定ファイル');
  });

  it('0 件は exit 0 でメッセージ表示', async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue({ events: [], truncated: false });
    const io = makeIo();
    const code = await runErrorsCommand(['errors', 'g'], io, makeDeps({ fetch }));
    expect(code).toBe(0);
    expect(io.out.join('')).toContain('該当時間帯にエラーは見つかりませんでした');
  });

  it('--filter は level 由来のパターンを上書きする', async () => {
    const fetch = vi.fn<(q: LogQuery) => Promise<FetchResult>>().mockResolvedValue(okResult);
    const io = makeIo();
    await runErrorsCommand(['errors', 'g', '--filter', '{ $.level = "ERROR" }'], io, makeDeps({ fetch }));
    expect(fetch.mock.calls[0]![0].filterPattern).toBe('{ $.level = "ERROR" }');
  });

  it('--profile/--region を providerFactory へ渡す', async () => {
    const factory = vi.fn(() => ({ fetch: vi.fn().mockResolvedValue(okResult) }) as unknown as LogProvider);
    const io = makeIo();
    await runErrorsCommand(
      ['errors', 'g', '--profile', 'prod', '--region', 'ap-northeast-1'],
      io,
      { providerFactory: factory, env: { HOME: '/tmp' }, now: () => NOW },
    );
    expect(factory).toHaveBeenCalledWith({ region: 'ap-northeast-1', profile: 'prod' });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/cli/errors-command.test.ts`
Expected: FAIL（追加ケースが全滅。スケルトンケースは残存 PASS）

- [ ] **Step 3: errors-command.ts を全面実装**

```ts
import { CloudWatchLogsClient } from '@aws-sdk/client-cloudwatch-logs';
import { Command, CommanderError } from 'commander';
import { aggregateEvents } from '../core/aggregate.js';
import { parseDuration } from '../core/duration.js';
import { loadConfig, resolveGroupName } from '../config/load.js';
import { CloudWatchProvider } from '../providers/cloudwatch.js';
import type { LogProvider } from '../providers/types.js';
import { renderJson } from '../render/json.js';
import { renderMarkdown } from '../render/markdown.js';
import { renderTable } from '../render/table.js';
import { VERSION } from '../version.js';
import { buildFilterPattern } from './filter-pattern.js';

export interface CliIo {
  stdout(text: string): void;
  stderr(text: string): void;
}

export interface RunDeps {
  providerFactory(opts: { region?: string; profile?: string }): LogProvider;
  env: NodeJS.ProcessEnv;
  now(): Date;
}

interface ErrorsOptions {
  time?: string;
  level?: string;
  format?: string;
  top?: string;
  limit?: string;
  filter?: string;
  profile?: string;
  region?: string;
}

const DEFAULTS = { time: '15m', level: 'ERROR', format: 'table', top: 20, limit: 1000 } as const;
const FORMATS = ['table', 'json', 'md'] as const;

function positiveInt(flag: string, raw: string | number | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`${flag} には正の整数を指定してください: "${raw}"`);
  }
  return n;
}

function classifyError(err: unknown): string {
  const name = (err as { name?: string }).name;
  const message = err instanceof Error ? err.message : String(err);
  switch (name) {
    case 'ResourceNotFoundException':
      return `ロググループが見つかりません。グループ名と ~/.config/toil-buster/config.json のエイリアスを確認してください (${message})`;
    case 'CredentialsProviderError':
    case 'AccessDeniedException':
      return `AWS 認証エラー。aws configure または --profile を確認してください (${message})`;
    default:
      return `エラー: ${message}`;
  }
}

function formatError(err: unknown, format: string): string {
  const message = classifyError(err);
  if (format === 'json') return `${JSON.stringify({ error: message })}\n`;
  return `${message}\n`;
}

async function execute(
  group: string,
  o: ErrorsOptions,
  io: CliIo,
  deps: RunDeps,
): Promise<number> {
  let format: string = DEFAULTS.format;
  try {
    const config = loadConfig(deps.env);
    const resolvedGroup = resolveGroupName(group, config.aliases);
    format = o.format ?? config.defaults.format ?? DEFAULTS.format;
    if (!(FORMATS as readonly string[]).includes(format)) {
      throw new Error(`不正なフォーマット: "${format}" (table | json | md)`);
    }
    const timeSpec = o.time ?? config.defaults.time ?? DEFAULTS.time;
    const levelSpec = o.level ?? DEFAULTS.level;
    const top = positiveInt('--top', o.top ?? config.defaults.top, DEFAULTS.top);
    const limit = positiveInt('--limit', o.limit ?? config.defaults.limit, DEFAULTS.limit);
    const region = o.region ?? config.defaults.region;
    const profile = o.profile ?? config.defaults.profile;

    const windowMs = parseDuration(timeSpec);
    const end = deps.now();
    const start = new Date(end.getTime() - windowMs);
    const filterPattern = o.filter ?? buildFilterPattern(levelSpec.split(','));

    const { events, truncated } = await deps
      .providerFactory({ region, profile })
      .fetch({ logGroup: resolvedGroup, startTime: start, endTime: end, filterPattern, limit });

    const summary = aggregateEvents(resolvedGroup, start, end, events, truncated);
    const renderer = format === 'json' ? renderJson : format === 'md' ? renderMarkdown : renderTable;
    io.stdout(renderer(summary, top));
    return 0;
  } catch (err) {
    io.stderr(formatError(err, format));
    return 1;
  }
}

const defaultProviderFactory = (opts: { region?: string; profile?: string }): LogProvider =>
  new CloudWatchProvider(new CloudWatchLogsClient(opts));

export async function runErrorsCommand(
  argv: string[],
  io: CliIo,
  deps?: Partial<RunDeps>,
): Promise<number> {
  const program = new Command();
  program
    .name('tb')
    .description('Toil Buster - CloudWatch Logs エラー抽出・統計CLI')
    .version(VERSION);
  program.exitOverride();
  program.configureOutput({
    writeOut: (s) => io.stdout(s),
    writeErr: (s) => io.stderr(s),
  });
  let parsed: { group: string; options: ErrorsOptions } | undefined;
  program
    .command('errors <group>')
    .description('指定期間のエラーログを抽出して統計表示')
    .option('-t, --time <dur>', '時間窓 (10m / 1h / 2d)。デフォルト 15m')
    .option('-l, --level <levels>', '対象レベル (カンマ区切り)。デフォルト ERROR')
    .option('-f, --format <fmt>', '出力形式: table | json | md。デフォルト table')
    .option('--top <n>', '頻度ランキング上位件数。デフォルト 20')
    .option('--limit <n>', '取得最大イベント数。デフォルト 1000')
    .option('--filter <pattern>', 'CloudWatch フィルタパターン直接指定')
    .option('--profile <name>', 'AWS profile')
    .option('--region <region>', 'AWS region')
    .action((group, options) => {
      parsed = { group, options: options as ErrorsOptions };
    });
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (err) {
    if (err instanceof CommanderError) return err.exitCode;
    throw err; // 予期しない例外は index.ts の .catch が拾って exit 1
  }
  if (parsed === undefined) return 0; // --help / --version
  const fullDeps: RunDeps = {
    providerFactory: deps?.providerFactory ?? defaultProviderFactory,
    env: deps?.env ?? process.env,
    now: deps?.now ?? (() => new Date()),
  };
  return execute(parsed.group, parsed.options, io, fullDeps);
}
```

※ `-t` を time、`-l` を level に充てる（`--time` / `--level` のロング形式も使用可）。

- [ ] **Step 4: テスト通過を確認**

Run: `npx vitest run src/cli/errors-command.test.ts`
Expected: PASS（スケルトン 3 + 追加 11 = 14 tests）

- [ ] **Step 5: 全体グリーン確認**

Run: `npm run build && npm run lint && npm run typecheck && npm test`
Expected: すべて成功、coverage 80% 以上

- [ ] **Step 6: コミット**

```bash
git add src/cli/errors-command.ts src/cli/errors-command.test.ts
git commit -m "feat: errors コマンド本体 (ワイヤリング・エラー分類) を実装"
```

---

### Task 10: bin 配布構成・E2E・README

**Files:**
- Create: `bin/tb.js`, `src/cli/e2e.test.ts`
- Modify: `package.json`（bin / files）、`README.md`
- Test: `src/cli/e2e.test.ts`

**Interfaces:**
- Consumes: `src/cli/index.ts`（Task 1/9）、`dist/cli/index.js`（ビルド成果物）
- Produces: `tb` コマンド（`bin/tb.js` → `dist/cli/index.js`）

- [ ] **Step 1: bin シムを作成**

`bin/tb.js`:

```js
#!/usr/bin/env node
import('../dist/cli/index.js');
```

```bash
chmod +x bin/tb.js
npm pkg set bin.tb="bin/tb.js" files='["bin","dist"]'
```

- [ ] **Step 2: E2E テストを書く（実際のプロセス spawn）**

`src/cli/e2e.test.ts`:

```ts
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const runCli = (args: string[]) =>
  spawnSync(process.execPath, ['--import', 'tsx', 'src/cli/index.ts', ...args], {
    encoding: 'utf8',
  });

describe('tb CLI (E2E)', () => {
  it('--help は exit 0 で usage を出す', () => {
    const res = runCli(['--help']);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain('errors <group>');
  });

  it('--version は 0.1.0', () => {
    const res = runCli(['--version']);
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe('0.1.0');
  });

  it('不正な --time は exit 1 で stderr に Invalid duration', () => {
    const res = runCli(['errors', 'some-group', '--time', 'bad']);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain('Invalid duration');
  });

  it('未知のオプションは 0 以外の終了コードで usage エラー', () => {
    const res = runCli(['errors', 'g', '--bogus']);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain('error');
  });
});
```

- [ ] **Step 3: テスト実行**

Run: `npx vitest run src/cli/e2e.test.ts`
Expected: PASS（4 tests。AWS には接続しない — 不正 time は provider 生成前に弾かれるため）

- [ ] **Step 4: ビルド成果物と bin の動作確認**

```bash
npm run build
node bin/tb.js --help
```

Expected: `dist/cli/index.js` が生成され、`node bin/tb.js --help` が usage を表示。さらに `npm pack --dry-run` で `bin/` と `dist/` が tarball に含まれることを確認。

- [ ] **Step 5: README.md を書き換える**

```markdown
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
npm run build   # tsup → dist/cli/index.js
```

## ライセンス

MIT
```

- [ ] **Step 6: 全体グリーン確認**

Run: `npm run build && npm run lint && npm run typecheck && npm test`
Expected: すべて成功

- [ ] **Step 7: コミット**

```bash
git add bin/ src/cli/e2e.test.ts package.json README.md
git commit -m "feat: bin 配布構成、E2E テスト、README を追加"
```

---

### Task 11: GitHub リポジトリ作成とセキュリティ基盤適用（要ユーザー確認）

**Files:**
- 変更なし（リポジトリ運用設定のみ）

**Interfaces:**
- Consumes: `scripts/apply-security.sh`（Task 1 でテンプレートから取り込み済み）
- Produces: GitHub リポジトリとブランチ保護・Dependabot・シークレットスキャン設定

※ **外部へ影響する操作のため、実行前にユーザーへ確認すること。**

- [ ] **Step 1: リポジトリ作成と push（可視性はユーザーに確認）**

```bash
gh repo create y-maeda1116/toil-buster-cli --private --source . --push
```

- [ ] **Step 2: セキュリティ基盤の適用**

```bash
./scripts/apply-security.sh y-maeda1116/toil-buster-cli
```

適用内容: 脆弱性アラート (Dependabot alerts)、プライベート脆弱性報告、シークレットスキャン + プッシュ保護。

- [ ] **Step 3: 結果をユーザーに報告**

リポジトリ URL、適用されたセキュリティ設定、CI の初回実行結果を報告する。
