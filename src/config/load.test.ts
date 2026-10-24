import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configFilePath, loadConfig, resolveGroupName } from "./load.js";

const dirs: string[] = [];
const withConfig = (content: string): { XDG_CONFIG_HOME: string; HOME: string } => {
  const dir = mkdtempSync(join(tmpdir(), "tb-config-"));
  dirs.push(dir);
  const xdg = join(dir, "xdg");
  mkdirSync(join(xdg, "toil-buster"), { recursive: true });
  writeFileSync(join(xdg, "toil-buster", "config.json"), content);
  return { XDG_CONFIG_HOME: xdg, HOME: join(dir, "home") };
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("configFilePath", () => {
  it("XDG_CONFIG_HOME 指定時はその直下", () => {
    expect(configFilePath({ XDG_CONFIG_HOME: "/xdg", HOME: "/home" })).toBe(
      "/xdg/toil-buster/config.json"
    );
  });
  it("未指定時は HOME/.config 配下", () => {
    expect(configFilePath({ HOME: "/home" })).toBe("/home/.config/toil-buster/config.json");
  });
});

describe("loadConfig", () => {
  it("ファイルがなければデフォルト設定を返す", () => {
    const env = { XDG_CONFIG_HOME: "/nonexistent-tb", HOME: "/nonexistent-tb" };
    expect(loadConfig(env)).toEqual({ aliases: {}, ignore: [], defaults: {} });
  });

  it("有効な設定を読み込む", () => {
    const env = withConfig(
      JSON.stringify({
        aliases: { "prod-api": "/aws/lambda/prod-api" },
        defaults: { region: "ap-northeast-1", time: "30m", format: "json" },
      })
    );
    expect(loadConfig(env)).toEqual({
      aliases: { "prod-api": "/aws/lambda/prod-api" },
      ignore: [],
      defaults: { region: "ap-northeast-1", time: "30m", format: "json" },
    });
  });

  it("壊れた JSON はエラー", () => {
    const env = withConfig("{ not json");
    expect(() => loadConfig(env)).toThrow(/設定ファイル/);
  });

  it("スキーマ違反 (aliases が数値) はエラー", () => {
    const env = withConfig(JSON.stringify({ aliases: 5 }));
    expect(() => loadConfig(env)).toThrow(/設定ファイル/);
  });

  it("defaults の部分的な指定も許容する", () => {
    const env = withConfig(JSON.stringify({ defaults: { top: 5 } }));
    expect(loadConfig(env).defaults).toEqual({ top: 5 });
  });

  it("ignore パターンを読み込む", () => {
    const env = withConfig(
      JSON.stringify({
        ignore: ["NoSuchElementException", "/Connection reset by peer/"],
      })
    );
    expect(loadConfig(env).ignore).toEqual([
      "NoSuchElementException",
      "/Connection reset by peer/",
    ]);
  });

  it("ignore 未指定時は空配列", () => {
    const env = withConfig(JSON.stringify({ aliases: {} }));
    expect(loadConfig(env).ignore).toEqual([]);
  });

  it("ignore が文字列配列でなければエラー", () => {
    const env = withConfig(JSON.stringify({ ignore: [1, 2] }));
    expect(() => loadConfig(env)).toThrow(/設定ファイル/);
  });
});

describe("resolveGroupName", () => {
  it("エイリアスを解決する", () => {
    expect(resolveGroupName("prod-api", { "prod-api": "/aws/lambda/prod-api" })).toBe(
      "/aws/lambda/prod-api"
    );
  });
  it("未登録の名前はそのまま返す", () => {
    expect(resolveGroupName("/aws/lambda/other", { "prod-api": "/aws/lambda/prod-api" })).toBe(
      "/aws/lambda/other"
    );
  });
});
