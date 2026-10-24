export interface GroupCount {
  pattern: string;
  count: number;
}

export type CompareStatus = "new" | "increased" | "unchanged" | "decreased" | "resolved";

export interface ComparedGroup {
  pattern: string;
  count: number;
  prevCount: number;
  delta: number;
  status: CompareStatus;
}

const STATUS_ORDER: Record<CompareStatus, number> = {
  new: 0,
  increased: 1,
  unchanged: 2,
  decreased: 3,
  resolved: 4,
};

export function compareGroups(
  current: readonly GroupCount[],
  previous: readonly GroupCount[]
): ComparedGroup[] {
  const prevByPattern = new Map(previous.map((g) => [g.pattern, g.count]));
  const currentPatterns = new Set(current.map((g) => g.pattern));
  const result: ComparedGroup[] = current.map((g) => {
    const prevCount = prevByPattern.get(g.pattern) ?? 0;
    const delta = g.count - prevCount;
    const status: CompareStatus =
      prevCount === 0 ? "new" : delta > 0 ? "increased" : delta < 0 ? "decreased" : "unchanged";
    return { pattern: g.pattern, count: g.count, prevCount, delta, status };
  });
  for (const g of previous) {
    if (!currentPatterns.has(g.pattern)) {
      result.push({
        pattern: g.pattern,
        count: 0,
        prevCount: g.count,
        delta: -g.count,
        status: "resolved",
      });
    }
  }
  // 同 status では変化の大きい順。resolved は delta が常に負のため
  // 「消えた件数が大きい順」を明示的に指定する。
  return result.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
      (a.status === "resolved" ? b.prevCount - a.prevCount : b.delta - a.delta)
  );
}
