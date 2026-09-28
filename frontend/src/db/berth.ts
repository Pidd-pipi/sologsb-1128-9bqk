import type { FishingPort } from '../types/port';
import type { Berth, BerthStatus } from '../types/berth';
import { hoursAgo } from './seed-time';

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export interface SeedOccupancy {
  berthNo: string;
  vesselId: string;
  vesselName: string;
  status: BerthStatus;
  berthAt: string;
  /** 本次占用对应的进港流水 id */
  entryCallId: string;
}

/** 演示数据中的初始占用 / 维修泊位（占用记录的 berthAt / entryCallId 与进港流水同源） */
export const SEED_OCCUPANCY: Record<string, SeedOccupancy[]> = {
  'p-1001': [
    { berthNo: 'B01', vesselId: 'v-2001', vesselName: '浙象渔05123', status: '占用', berthAt: hoursAgo(5), entryCallId: 'c-3001' },
    { berthNo: 'B02', vesselId: 'v-2005', vesselName: '浙象渔05288', status: '占用', berthAt: hoursAgo(3), entryCallId: 'c-3002' },
    { berthNo: 'B04', vesselId: '', vesselName: '', status: '维修', berthAt: '', entryCallId: '' },
  ],
  'p-1002': [
    { berthNo: 'B01', vesselId: 'v-2002', vesselName: '浙普渔13208', status: '占用', berthAt: hoursAgo(2), entryCallId: 'c-3003' },
    // 靠泊 52 小时：超过 48 小时滞留阈值，用于演示滞留提示
    { berthNo: 'B02', vesselId: 'v-2006', vesselName: '浙普渔13566', status: '占用', berthAt: hoursAgo(52), entryCallId: 'c-3006' },
    { berthNo: 'B06', vesselId: '', vesselName: '', status: '维修', berthAt: '', entryCallId: '' },
  ],
  'p-1003': [
    { berthNo: 'B01', vesselId: 'v-2003', vesselName: '浙岱渔07156', status: '占用', berthAt: hoursAgo(1), entryCallId: 'c-3004' },
  ],
  'p-1004': [
    { berthNo: 'B02', vesselId: 'v-2004', vesselName: '浙岭渔09342', status: '占用', berthAt: hoursAgo(6), entryCallId: 'c-3009' },
  ],
};

/**
 * 按渔港登记的泊位数生成泊位记录（初始播种与 Dexie v3/v4 迁移共用）。
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
      berthAt: occupied ? hit.berthAt : null,
      leaveAt: null,
      entryCallId: occupied ? hit.entryCallId : null,
      status: hit ? hit.status : '空闲',
      designDepth: port.berthDepth,
    });
  }
  return records;
}
