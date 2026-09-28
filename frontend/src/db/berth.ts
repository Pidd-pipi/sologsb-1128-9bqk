import type { FishingPort } from '../types/port';
import type { Berth, BerthStatus } from '../types/berth';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 3600 * 1000).toISOString();
}

export interface SeedOccupancy {
  berthNo: string;
  vesselId: string;
  vesselName: string;
  status: BerthStatus;
  berthAt: string;
  /** 对应的演示进港记录 id（与 SEED_CALLS 中的进港流水绑定） */
  entryCallId?: string;
}

/**
 * 演示数据中的初始占用 / 维修泊位。
 * 占用泊位的 entryCallId 指向同一条进港流水（见 seed.ts 的 SEED_CALLS），
 * 保证列表、泊位格、渔船档案读到的是同一笔“渔船 + 时间 + 泊位”记录。
 * 其中沈家门 B02 的浙普渔13566 靠泊已 26 小时，按 50 小时播种以演示 48 小时滞留提示。
 */
export const SEED_OCCUPANCY: Record<string, SeedOccupancy[]> = {
  'p-1001': [
    { berthNo: 'B01', vesselId: 'v-2001', vesselName: '浙象渔05123', status: '占用', berthAt: hoursAgo(5), entryCallId: 'c-3001' },
    { berthNo: 'B02', vesselId: 'v-2005', vesselName: '浙象渔05288', status: '占用', berthAt: hoursAgo(3), entryCallId: 'c-3002' },
    { berthNo: 'B04', vesselId: '', vesselName: '', status: '维修', berthAt: '' },
  ],
  'p-1002': [
    { berthNo: 'B01', vesselId: 'v-2002', vesselName: '浙普渔13208', status: '占用', berthAt: hoursAgo(2), entryCallId: 'c-3003' },
    { berthNo: 'B02', vesselId: 'v-2006', vesselName: '浙普渔13566', status: '占用', berthAt: hoursAgo(50), entryCallId: 'c-3006' },
    { berthNo: 'B06', vesselId: '', vesselName: '', status: '维修', berthAt: '' },
  ],
  'p-1003': [
    { berthNo: 'B01', vesselId: 'v-2003', vesselName: '浙岱渔07156', status: '占用', berthAt: hoursAgo(1), entryCallId: 'c-3004' },
  ],
  'p-1004': [],
};

/**
 * 按渔港登记的泊位数生成泊位记录（初始播种与 Dexie v3 迁移共用）。
 */
export function buildBerthRecords(
  port: FishingPort,
  occupancy: SeedOccupancy[] = SEED_OCCUPANCY[port.id] ?? [],
): Berth[] {
  const records: Berth[] = [];
  for (let i = 1; i <= port.berthCount; i++) {
    const berthNo = `B${pad2(i)}`;
    const hit = occupancy.find((o) => o.berthNo === berthNo);
    const occupied = hit && hit.status === '占用';
    records.push({
      id: `${port.id}-${berthNo}`,
      portId: port.id,
      berthNo,
      vesselId: occupied ? hit.vesselId : null,
      vesselName: occupied ? hit.vesselName : null,
      entryCallId: occupied && hit.entryCallId ? hit.entryCallId : null,
      berthAt: occupied ? hit.berthAt : null,
      leaveAt: null,
      status: hit ? hit.status : '空闲',
      designDepth: port.berthDepth,
    });
  }
  return records;
}
