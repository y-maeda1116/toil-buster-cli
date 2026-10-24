import { readFileSync } from "node:fs";
import { z } from "zod";

const configSchema = z.object({
  aliases: z.record(z.string(), z.string()).default({}),
  // 抑制する既知エラーのパターン。/.../ 形式は正規表現、それ以外は正規化済み
  // パターンとの完全一致。
  ignore: z.array(z.string()).default([]),
  defaults: z
    .object({
      region: z.string().optional(),
      time: z.string().optional(),
      format: z.enum(["table", "json", "md"]).optional(),
      profile: z.string().optional(),
      top: z.number().int().positive().optional(),
      limit: z.number().int().positive().optional(),
      // 使用するログバックエンド (cloudwatch | datadog)。
      provider: z.enum(["cloudwatch", "datadog"]).optional(),
    })
    .default({}),
});

export type AppConfig = z.infer<typeof configSchema>;

export interface ConfigEnv {
  XDG_CONFIG_HOME?: string;
  HOME?: string;
}

export function configFilePath(env: ConfigEnv): string {
  const base = env.XDG_CONFIG_HOME ?? `${env.HOME ?? ""}/.config`;
  return `${base}/toil-buster/config.json`;
}

export function loadConfig(env: ConfigEnv): AppConfig {
  const path = configFilePath(env);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { aliases: {}, ignore: [], defaults: {} };
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
