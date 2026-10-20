import { describe, expect, it, vi } from "vitest";
import { selectTargetGroup } from "./select-target.js";
import type { RunDeps } from "./errors-command.js";
import type { LogProvider } from "../providers/types.js";

const provider = {
  fetch: vi.fn(),
  listGroupNames: vi
    .fn<(prefix: string) => Promise<string[]>>()
    .mockResolvedValue(["/aws/lambda/prod-api", "/aws/lambda/prod-batch", "/aws/ec2/worker"]),
} as unknown as LogProvider;

const baseDeps = (overrides: Partial<RunDeps> = {}): Partial<RunDeps> => ({
  isTTY: () => true,
  ...overrides,
});

describe("selectTargetGroup", () => {
  it("グループ指定があればそのまま返す (対話しない)", async () => {
    const selectGroup = vi.fn();
    const deps = baseDeps({ selectGroup });
    const name = await selectTargetGroup("prod-api", provider, deps);
    expect(name).toBe("prod-api");
    expect(selectGroup).not.toHaveBeenCalled();
    expect(provider.listGroupNames).not.toHaveBeenCalled();
  });

  it("省略時は一覧を取得して選択 UI に渡す", async () => {
    const selectGroup = vi
      .fn<(choices: readonly string[]) => Promise<string>>()
      .mockResolvedValue("/aws/ec2/worker");
    const deps = baseDeps({ selectGroup });
    const name = await selectTargetGroup(undefined, provider, deps);
    expect(name).toBe("/aws/ec2/worker");
    expect(provider.listGroupNames).toHaveBeenCalledWith("");
    expect(selectGroup).toHaveBeenCalledWith([
      "/aws/lambda/prod-api",
      "/aws/lambda/prod-batch",
      "/aws/ec2/worker",
    ]);
  });

  it("非 TTY で selectGroup も無ければエラーにする", async () => {
    const deps = baseDeps({ isTTY: () => false });
    await expect(selectTargetGroup(undefined, provider, deps)).rejects.toThrow(
      "ロググループ名を指定するか、ターミナル (TTY) から実行してください"
    );
  });

  it("一覧が空ならエラーにする", async () => {
    const emptyProvider = {
      fetch: vi.fn(),
      listGroupNames: vi.fn<(prefix: string) => Promise<string[]>>().mockResolvedValue([]),
    } as unknown as LogProvider;
    const selectGroup = vi.fn();
    const deps = baseDeps({ selectGroup });
    await expect(selectTargetGroup(undefined, emptyProvider, deps)).rejects.toThrow(
      "選択できるロググループが見つかりませんでした"
    );
  });
});
