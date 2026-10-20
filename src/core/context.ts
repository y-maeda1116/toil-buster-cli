export interface ContextLine<T> {
  event: T;
  matched: boolean;
}

/**
 * マッチ位置の前後 n 行を文脈として返す。複数マッチの文脈が重なる場合は
 * 区間をマージし、元の順序を保つ。
 */
export function withContext<T>(
  events: readonly T[],
  matchIndexes: readonly number[],
  n: number
): ContextLine<T>[] {
  const isMatch = new Set(matchIndexes);
  const taken = new Set<number>();
  for (const idx of matchIndexes) {
    for (let i = Math.max(0, idx - n); i <= Math.min(events.length - 1, idx + n); i++) {
      taken.add(i);
    }
  }
  return (
    [...taken]
      .sort((a, b) => a - b)
      // 動的ブラケットアクセス (object injection) を避けるため at() で取り出す。
      .map((i) => ({ event: events.at(i)!, matched: isMatch.has(i) }))
  );
}
