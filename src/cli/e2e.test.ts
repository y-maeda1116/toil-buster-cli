import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const runCli = (args: string[]) =>
  spawnSync(process.execPath, ["--import", "tsx", "src/cli/index.ts", ...args], {
    encoding: "utf8",
  });

describe("tb CLI (E2E)", () => {
  it("--help は exit 0 で usage を出す", () => {
    const res = runCli(["--help"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("errors <group>");
  });

  it("--version は 0.1.0", () => {
    const res = runCli(["--version"]);
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe("0.1.0");
  });

  it("不正な --time は exit 1 で stderr に Invalid duration", () => {
    const res = runCli(["errors", "some-group", "--time", "bad"]);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Invalid duration");
  });

  it("未知のオプションは 0 以外の終了コードで usage エラー", () => {
    const res = runCli(["errors", "g", "--bogus"]);
    expect(res.status).not.toBe(0);
    expect(res.stderr).toContain("error");
  });

  it("tail --help は exit 0 で usage を出す", () => {
    const res = runCli(["tail", "--help"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("tail <group>");
  });

  it("show の --pattern 未指定は exit 0 以外", () => {
    const res = runCli(["show", "some-group"]);
    expect(res.status).not.toBe(0);
  });
});
