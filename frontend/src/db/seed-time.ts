/**
 * 种子数据统一时间源：泊位占用的 berthAt 与进港流水的 time 必须是同一时刻，
 * 不能各自调用 Date.now()（会差几毫秒）。这里在模块加载时只计算一次，
 * 泊位种子与流水种子按同一 key 取同一个 ISO 时间。
 */
const stampCache = new Map<string, string>();

function stamp(kind: 'h' | 'd', value: number): string {
  const key = `${kind}:${value}`;
  const hit = stampCache.get(key);
  if (hit) return hit;
  const factor = kind === 'h' ? 3600 * 1000 : 24 * 3600 * 1000;
  const iso = new Date(Date.now() - value * factor).toISOString();
  stampCache.set(key, iso);
  return iso;
}

export function hoursAgo(hours: number): string {
  return stamp('h', hours);
}

export function daysAgo(days: number): string {
  return stamp('d', days);
}
