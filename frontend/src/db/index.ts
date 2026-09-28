import Dexie, { type Table } from 'dexie';
import type { FishingPort } from '../types/port';
import type { FishingVessel } from '../types/vessel';
import type { PortCall } from '../types/call';
import type { Berth } from '../types/berth';
import { buildBerthRecords } from './berth';

/**
 * gbfishport-db：库名固定为 gbfishport-db
 * v1 建 ports / vessels；v2 新增 calls 表与 vesselId 索引；v3 新增 berths 表并按泊位数生成初始记录；
 * v4 进出港记录与泊位占用绑定：calls 增 portId 索引、berths 增 entryCallId 索引，并回填历史数据。
 */
export class FishPortDatabase extends Dexie {
  ports!: Table<FishingPort, string>;
  vessels!: Table<FishingVessel, string>;
  calls!: Table<PortCall, string>;
  berths!: Table<Berth, string>;

  constructor() {
    super('gbfishport-db');

    this.version(1).stores({
      ports: 'id, name, level, shelterLevel',
      vessels: 'id, vesselNo, homePort, operationType, enginePower, grossTonnage',
    });

    this.version(2)
      .stores({
        calls: 'id, vesselId, type, time',
      })
      .upgrade(async (tx) => {
        // v2 迁移：新增 calls 表与 vesselId 索引，回填历史记录的冗余字段
        await tx
          .table<PortCall, string>('calls')
          .toCollection()
          .modify((call) => {
            if (!call.vesselName) call.vesselName = '';
            if (!call.visaStatus) call.visaStatus = '待签证';
          });
      });

    this.version(3)
      .stores({
        berths: 'id, portId, berthNo, status, vesselId',
      })
      .upgrade(async (tx) => {
        // v3 迁移：新增 berths 表，并按每个渔港登记的泊位数生成初始泊位记录
        const ports = await tx.table<FishingPort, string>('ports').toArray();
        const berthTable = tx.table<Berth, string>('berths');
        for (const port of ports) {
          const existing = await berthTable.where('portId').equals(port.id).count();
          if (existing === 0) {
            await berthTable.bulkPut(buildBerthRecords(port));
          }
        }
      });

    this.version(4)
      .stores({
        calls: 'id, vesselId, type, time, portId',
        berths: 'id, portId, berthNo, status, vesselId, entryCallId',
      })
      .upgrade(async (tx) => {
        const callTable = tx.table<PortCall, string>('calls');
        const berthTable = tx.table<Berth, string>('berths');
        const portTable = tx.table<FishingPort, string>('ports');
        const vesselTable = tx.table<FishingVessel, string>('vessels');

        const [ports, vessels, berths, calls] = await Promise.all([
          portTable.toArray(),
          vesselTable.toArray(),
          berthTable.toArray(),
          callTable.toArray(),
        ]);

        // 回填 calls.portId：优先按“当前仍占用同号泊位”匹配，其次用船籍港名称匹配渔港，最后回退同号泊位
        const callsNext = calls.map((call) => {
          if (call.portId) return call;
          const byOccupant = berths.find((b) => b.berthNo === call.berthNo && b.vesselId === call.vesselId);
          if (byOccupant) return { ...call, portId: byOccupant.portId };
          const vessel = vessels.find((v) => v.id === call.vesselId);
          if (vessel) {
            const byHomePort = ports.find((p) => p.name.includes(vessel.homePort));
            if (byHomePort) return { ...call, portId: byHomePort.id };
          }
          const byBerthNo = berths.find((b) => b.berthNo === call.berthNo);
          return { ...call, portId: byBerthNo?.portId ?? '' };
        });
        await callTable.bulkPut(callsNext);

        // 回填 berths.entryCallId：把占用泊位指向同船同泊位的最近一条进港记录，靠泊时间以该记录为准；
        // 空闲 / 维修泊位显式置空，补齐老记录缺失的字段
        const berthsNext = berths.map((berth) => {
          if (berth.status !== '占用' || !berth.vesselId) {
            return { ...berth, entryCallId: null };
          }
          if (berth.entryCallId) return berth;
          const entry = [...callsNext]
            .filter((c) => c.type === '进港' && c.vesselId === berth.vesselId && c.portId === berth.portId && c.berthNo === berth.berthNo)
            .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())[0];
          if (!entry) return { ...berth, entryCallId: null };
          return { ...berth, entryCallId: entry.id, berthAt: entry.time };
        });
        await berthTable.bulkPut(berthsNext);
      });
  }
}

export const db = new FishPortDatabase();
