/** 泊位状态 */
export type BerthStatus = '空闲' | '占用' | '维修';

export const BERTH_STATUSES: BerthStatus[] = ['空闲', '占用', '维修'];

/** 超过该靠泊时长（小时）给出滞留提示 */
export const DETENTION_HOURS = 48;

/** 泊位占用记录：与进港流水为同一笔记录的泊位侧视图 */
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
  /** 靠泊时间（ISO 字符串），与进港流水的 time 一致 */
  berthAt: string | null;
  /** 离泊时间（ISO 字符串） */
  leaveAt: string | null;
  /** 本次占用对应的进港流水 id，列表 / 泊位格 / 渔船档案凭它回到同一条记录 */
  entryCallId: string | null;
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
  freeBerths: Berth[];
  occupiedBerths: Berth[];
}
