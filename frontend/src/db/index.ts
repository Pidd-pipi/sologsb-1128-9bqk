import Dexie, { type Table } from 'dexie';
import type { FishingPort } from '../types/port';
import type { FishingVessel } from '../types/vessel';
import type { PortCall } from '../types/call';
import type { Berth } from '../types/berth';
import { buildBerthRecords } from './berth';
import { resolveCallPortId, resolveEntryCallId } from './migration';

/**
 * gbfishport-db：库名固定为 gbfishport-db
 * v1 建 ports / vessels；v2 新增 calls 表与 vesselId 索引；v3 新增 berths 表并按泊位数生成初始记录；
 * v4 进出港记录与泊位占用绑定：calls 增加 portId 索引、berths 增加 entryCallId 字段，并回填历史数据。
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
        // portId 建索引，支持「某渔港全部流水」查询；泊位与流水经 entryCallId 互查
        calls: 'id, vesselId, type, time, portId',
        berths: 'id, portId, berthNo, status, vesselId, entryCallId',
      })
      .upgrade(async (tx) => {
        const [ports, vessels, calls, berths] = await Promise.all([
          tx.table<FishingPort, string>('ports').toArray(),
          tx.table<FishingVessel, string>('vessels').toArray(),
          tx.table<PortCall, string>('calls').toArray(),
          tx.table<Berth, string>('berths').toArray(),
        ]);

        // 回填每条流水的归属渔港，再凭进港流水回填占用泊位的 entryCallId
        const callsById = new Map<string, PortCall>();
        for (const call of calls) {
          call.portId = resolveCallPortId(call, ports, berths, vessels);
          callsById.set(call.id, call);
        }
        for (const berth of berths) {
          berth.entryCallId = berth.entryCallId ?? resolveEntryCallId(berth, calls);
        }

        if (calls.length) await tx.table<PortCall, string>('calls').bulkPut(calls);
        if (berths.length) await tx.table<Berth, string>('berths').bulkPut(berths);
      });
  }
}

export const db = new FishPortDatabase();
