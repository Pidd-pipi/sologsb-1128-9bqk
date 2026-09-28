import { DETENTION_HOURS } from '../types/berth';

/**
 * 靠泊时长 / 滞留判定：渔港详情列表、泊位格、渔船档案共用同一套口径，
 * 数据均来自 berths 表中那条占用记录（与进港流水一一对应）。
 */

/** 靠泊时长（毫秒）；没有靠泊时间或时间非法时返回 null */
export function berthedMs(berthAt: string | null | undefined, now: number = Date.now()): number | null {
  if (!berthAt) return null;
  const start = new Date(berthAt).getTime();
  if (Number.isNaN(start)) return null;
  return Math.max(0, now - start);
}

/** 靠泊小时数（一位小数）；无法计算时返回 null */
export function berthedHours(berthAt: string | null | undefined, now: number = Date.now()): number | null {
  const ms = berthedMs(berthAt, now);
  return ms === null ? null : ms / 3600_000;
}

/** 是否滞留：持续靠泊超过 48 小时 */
export function isDetained(berthAt: string | null | undefined, now: number = Date.now()): boolean {
  const hours = berthedHours(berthAt, now);
  return hours !== null && hours > DETENTION_HOURS;
}

/** 完整时长文案，如「3 小时 20 分」「2 天 5 小时」 */
export function durationText(berthAt: string | null | undefined, now: number = Date.now()): string {
  const ms = berthedMs(berthAt, now);
  if (ms === null) return '—';
  const minutesTotal = Math.floor(ms / 60000);
  const days = Math.floor(minutesTotal / 1440);
  const hours = Math.floor((minutesTotal % 1440) / 60);
  const minutes = minutesTotal % 60;
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  return `${Math.max(minutes, 0)} 分`;
}

/** 泊位格用的紧凑时长文案，如「3.3h」「52.0h」；无法计算时返回空串 */
export function durationShort(berthAt: string | null | undefined, now: number = Date.now()): string {
  const hours = berthedHours(berthAt, now);
  if (hours === null) return '';
  return `${hours.toFixed(1)}h`;
}
