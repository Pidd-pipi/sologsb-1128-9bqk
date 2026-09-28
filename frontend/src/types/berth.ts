/** 泊位状态 */
export type BerthStatus = '空闲' | '占用' | '维修';

export const BERTH_STATUSES: BerthStatus[] = ['空闲', '占用', '维修'];

/** 泊位占用记录 */
export interface Berth {
  id: string;
  /** 所属渔港 id */
  portId: string;
  /** 泊位号 */
  berthNo: string;
  /** 占用渔船 id */
  vesselId: string | null;
  /** 占用渔船名 */
  vesselName: string | null;
  /**
   * 本次占用对应的进港记录 id（与 calls 表中的同一条进港流水绑定）。
   * 出港登记时凭它核对“这条船正是泊位占用者”，核对通过后随出港记录一并清空。
   */
  entryCallId: string | null;
  /** 靠泊时间（ISO 字符串，取自进港记录的 time） */
  berthAt: string | null;
  /** 离泊时间（ISO 字符串，取自出港记录的 time） */
  leaveAt: string | null;
  /** 状态：空闲 / 占用 / 维修 */
  status: BerthStatus;
  /** 泊位设计水深 m */
  designDepth: number;
}

/** 泊位占用聚合结果（useBerthStatus 输出） */
export interface BerthSummary {
  portId: string;
  total: number;
  occupied: number;
  free: number;
  maintenance: number;
  /** 占用率 0-1 */
  occupancyRate: number;
  /** 在港船舶数量 */
  inPortCount: number;
  /** 靠泊超过 48 小时尚未离港的船舶数量 */
  overstayCount: number;
  freeBerths: Berth[];
  occupiedBerths: Berth[];
  /** 靠泊超过 48 小时的占用泊位 */
  overstayBerths: Berth[];
}

/** 滞留判定阈值：靠泊超过 48 小时 */
export const OVERSTAY_HOURS = 48;

/** 靠泊时长（毫秒），berthAt 缺失或非法时返回 null */
export function berthedDurationMs(berthAt: string | null | undefined, now: number = Date.now()): number | null {
  if (!berthAt) return null;
  const t = new Date(berthAt).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, now - t);
}

/** 是否超过 48 小时滞留 */
export function isOverstay(berthAt: string | null | undefined, now: number = Date.now()): boolean {
  const d = berthedDurationMs(berthAt, now);
  return d !== null && d > OVERSTAY_HOURS * 3600 * 1000;
}

/** 靠泊时长文案，如 3.5 小时 / 2 天 6 小时；缺失返回 '—' */
export function berthedDurationText(berthAt: string | null | undefined, now: number = Date.now()): string {
  const d = berthedDurationMs(berthAt, now);
  if (d === null) return '—';
  const hours = Math.floor(d / 3600000);
  if (hours < 1) return `${Math.max(1, Math.round(d / 60000))} 分钟`;
  if (hours < 24) return `${hours} 小时`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  return rest === 0 ? `${days} 天` : `${days} 天 ${rest} 小时`;
}
