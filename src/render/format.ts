const pad = (n: number) => String(n).padStart(2, "0");

export function formatTime(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatWindow(start: Date, end: Date): string {
  const d = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
  return `${d} ${formatTime(start)} 〜 ${formatTime(end)}`;
}
