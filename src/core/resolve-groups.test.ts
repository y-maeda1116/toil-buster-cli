import { describe, expect, it, vi } from "vitest";
import { MAX_GROUPS, resolveGroupExpressions } from "./resolve-groups.js";

const source = (names: string[]) => ({
  listGroupNames: vi.fn(async () => names),
});

describe("resolveGroupExpressions", () => {
  it("完全名はそのまま返し listGroupNames を呼ばない", async () => {
    const src = source(["/g"]);
    const result = await resolveGroupExpressions("/aws/lambda/prod-api", {}, src);
    expect(result).toEqual(["/aws/lambda/prod-api"]);
    expect(src.listGroupNames).not.toHaveBeenCalled();
  });

  it("エイリアスを解決する", async () => {
    const result = await resolveGroupExpressions(
      "prod-api",
      { "prod-api": "/aws/lambda/prod-api" },
      source([])
    );
    expect(result).toEqual(["/aws/lambda/prod-api"]);
  });

  it("末尾 * は prefix 展開する", async () => {
    const src = source(["/aws/lambda/prod-api", "/aws/lambda/prod-api-worker"]);
    const result = await resolveGroupExpressions("prod-api-*", {}, src);
    expect(result).toEqual(["/aws/lambda/prod-api", "/aws/lambda/prod-api-worker"]);
    expect(src.listGroupNames).toHaveBeenCalledWith("prod-api-");
  });

  it("エイリアス値の末尾 * も展開する", async () => {
    const src = source(["/aws/lambda/prod-api"]);
    const result = await resolveGroupExpressions("prod", { prod: "/aws/lambda/prod-*" }, src);
    expect(result).toEqual(["/aws/lambda/prod-api"]);
    expect(src.listGroupNames).toHaveBeenCalledWith("/aws/lambda/prod-");
  });

  it("カンマ区切りで複数指定でき、重複は排除される", async () => {
    const result = await resolveGroupExpressions("/a,/b,/a", {}, source([]));
    expect(result).toEqual(["/a", "/b"]);
  });

  it("ワイルドカードが 0 件ならエラーになる", async () => {
    await expect(resolveGroupExpressions("nope-*", {}, source([]))).rejects.toThrow(/nope-\*/);
  });

  it("展開数が上限を超えるとエラーになる", async () => {
    const many = Array.from({ length: MAX_GROUPS + 1 }, (_, i) => `/g${i}`);
    await expect(resolveGroupExpressions("g-*", {}, source(many))).rejects.toThrow(/上限/);
  });

  it("空白はトリミングされる", async () => {
    const result = await resolveGroupExpressions("/a, /b", {}, source([]));
    expect(result).toEqual(["/a", "/b"]);
  });
});
