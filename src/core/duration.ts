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
