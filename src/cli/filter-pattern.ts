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
    throw new Error("レベルが指定されていません (--level WARN,ERROR の形式で指定してください)");
  }
  return [...terms].map((t) => `?${t}`).join(" ");
}
