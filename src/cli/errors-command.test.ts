import { describe, expect, it } from "vitest";
import { runErrorsCommand, type CliIo } from "./errors-command.js";

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

describe("runErrorsCommand (skeleton)", () => {
  it("--help は終了コード 0 で usage を stdout に出す", async () => {
    const io = makeIo();
    const code = await runErrorsCommand(["--help"], io);
    expect(code).toBe(0);
    expect(io.out.join("")).toContain("tb");
  });

  it("--version はバージョン文字列を出す", async () => {
    const io = makeIo();
    const code = await runErrorsCommand(["--version"], io);
    expect(code).toBe(0);
    expect(io.out.join("")).toContain("0.1.0");
  });

  it("未知のオプションは 0 以外の終了コード", async () => {
    const io = makeIo();
    const code = await runErrorsCommand(["--bogus"], io);
    expect(code).not.toBe(0);
  });
});
