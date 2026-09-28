import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { liveQuery } from 'dexie';
import { db } from '../db';
import { toPlain, uid } from '../utils/format';
import { emptyPortFilter, type FishingPort, type PortFilter, type SupplyCapability } from '../types/port';
import type { Berth, BerthStatus } from '../types/berth';
import type { CallDraft, PortCall } from '../types/call';
import { buildBerthRecords } from '../db/berth';

export interface PortInput {
  name: string;
  level: FishingPort['level'];
  longitude: number;
  latitude: number;
  berthCount: number;
  berthDepth: number;
  wharfLength: number;
  shelterLevel: number;
  supply: SupplyCapability;
  manager: string;
}

/** 泊位核对失败原因（提交瞬间复查泊位当下状态时抛出） */
export type BerthConflictReason =
  | 'BERTH_NOT_FOUND'
  | 'NOT_FREE_ON_ENTRY'
  | 'NOT_OCCUPIED_ON_EXIT'
  | 'OCCUPIED_BY_OTHER';

/** 泊位占用冲突：旧页面持有的空闲/占用状态与库内最新状态不一致 */
export class BerthConflictError extends Error {
  reason: BerthConflictReason;
  /** 库内此刻的泊位占用渔船名（如有） */
  occupiedBy: string | null;
  /** 出港时，该渔船当前实际占用的泊位（OCCUPIED_BY_OTHER 时用于提示重选） */
  vesselBerth: { portId: string; berthNo: string } | null;

  constructor(
    reason: BerthConflictReason,
    message: string,
    occupiedBy: string | null = null,
    vesselBerth: { portId: string; berthNo: string } | null = null,
  ) {
    super(message);
    this.name = 'BerthConflictError';
    this.reason = reason;
    this.occupiedBy = occupiedBy;
    this.vesselBerth = vesselBerth;
  }
}

export const usePortStore = defineStore('port', () => {
  const ports = ref<FishingPort[]>([]);
  const berths = ref<Berth[]>([]);
  const calls = ref<PortCall[]>([]);
  const loading = ref(false);
  const filter = ref<PortFilter>(emptyPortFilter());

  const filteredPorts = computed(() => {
    const f = filter.value;
    const keyword = f.keyword.trim();
    return ports.value.filter((p) => {
      if (f.level && p.level !== f.level) return false;
      if (f.minShelterLevel !== null && p.shelterLevel < f.minShelterLevel) return false;
      if (keyword && !p.name.includes(keyword) && !p.manager.includes(keyword)) return false;
      return true;
    });
  });

  const callsSorted = computed(() =>
    [...calls.value].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()),
  );

  function portById(id: string): FishingPort | undefined {
    return ports.value.find((p) => p.id === id);
  }

  function berthsOf(portId: string): Berth[] {
    return berths.value.filter((b) => b.portId === portId).sort((a, b) => a.berthNo.localeCompare(b.berthNo));
  }

  /** 按渔港 + 泊位号定位唯一泊位 */
  function berthByKey(portId: string, berthNo: string): Berth | undefined {
    return berths.value.find((b) => b.portId === portId && b.berthNo === berthNo);
  }

  /** 该渔船当前占用的泊位（同一笔进港占用，正常最多 1 个） */
  function activeBerthOfVessel(vesselId: string): Berth | undefined {
    return berths.value.find((b) => b.status === '占用' && b.vesselId === vesselId);
  }

  function callsOfVessel(vesselId: string): PortCall[] {
    return callsSorted.value.filter((c) => c.vesselId === vesselId);
  }

  function callsOfPort(portId: string): PortCall[] {
    return callsSorted.value.filter((c) => c.portId === portId);
  }

  function resetFilter(): void {
    filter.value = emptyPortFilter();
  }

  async function loadAll(): Promise<void> {
    loading.value = true;
    try {
      const [p, b, c] = await Promise.all([db.ports.toArray(), db.berths.toArray(), db.calls.toArray()]);
      ports.value = p;
      berths.value = b;
      calls.value = c;
    } finally {
      loading.value = false;
    }
  }

  async function createPort(input: PortInput): Promise<FishingPort> {
    const port: FishingPort = {
      id: uid('p'),
      name: input.name.trim(),
      level: input.level,
      longitude: Number(input.longitude),
      latitude: Number(input.latitude),
      berthCount: Number(input.berthCount),
      berthDepth: Number(input.berthDepth),
      wharfLength: Number(input.wharfLength),
      shelterLevel: Number(input.shelterLevel),
      supply: { ...input.supply },
      manager: input.manager.trim(),
      createdAt: new Date().toISOString(),
    };
    // 写库前脱代理，避免 DataCloneError
    await db.ports.put(toPlain(port));
    const records = buildBerthRecords(port, []);
    await db.berths.bulkPut(toPlain(records));
    ports.value = [...ports.value, port];
    berths.value = [...berths.value, ...records];
    return port;
  }

  async function addBerth(portId: string, berthNo: string, designDepth: number): Promise<Berth | null> {
    const port = portById(portId);
    if (!port) return null;
    const no = berthNo.trim().toUpperCase();
    if (!no) return null;
    if (berthsOf(portId).some((b) => b.berthNo === no)) return null;
    const berth: Berth = {
      id: `${portId}-${no}`,
      portId,
      berthNo: no,
      vesselId: null,
      vesselName: null,
      entryCallId: null,
      berthAt: null,
      leaveAt: null,
      status: '空闲',
      designDepth: Number(designDepth) || port.berthDepth,
    };
    await db.berths.put(toPlain(berth));
    berths.value = [...berths.value, berth];
    const nextCount = berthsOf(portId).length;
    await updatePort(portId, { berthCount: nextCount });
    return berth;
  }

  async function setBerthStatus(berthId: string, status: BerthStatus): Promise<void> {
    const hit = berths.value.find((b) => b.id === berthId);
    if (!hit) return;
    const next: Berth = {
      ...hit,
      status,
      vesselId: status === '占用' ? hit.vesselId : null,
      vesselName: status === '占用' ? hit.vesselName : null,
      entryCallId: status === '占用' ? hit.entryCallId : null,
      berthAt: status === '占用' ? hit.berthAt ?? new Date().toISOString() : hit.berthAt,
      leaveAt: status === '空闲' ? new Date().toISOString() : null,
    };
    await db.berths.put(toPlain(next));
    berths.value = berths.value.map((b) => (b.id === berthId ? next : b));
  }

  async function updatePort(portId: string, patch: Partial<FishingPort>): Promise<void> {
    const hit = portById(portId);
    if (!hit) return;
    const next: FishingPort = { ...hit, ...patch };
    await db.ports.put(toPlain(next));
    ports.value = ports.value.map((p) => (p.id === portId ? next : p));
  }

  /**
   * 登记一条进出港记录，并与泊位占用绑定为同一笔数据（同一 Dexie 事务提交）。
   *
   * 提交瞬间复查泊位当下状态，避免旧页面把缓存的空闲状态一并提交：
   * - 进港：泊位必须此刻仍为空闲，随后写入渔船、时间与泊位，占用记录指向本条进港流水；
   * - 出港：泊位必须此刻由“本船”占用（entryCallId/vesselId 双重核对），
   *   已被别人占用或已被释放时抛 BerthConflictError，由页面保留草稿并提示重选。
   */
  async function registerCall(draft: CallDraft, vesselName: string, portId = draft.portId): Promise<PortCall> {
    const targetPortId = portId || draft.portId;
    const callId = uid('c');
    const nowIso = new Date().toISOString();
    const timeIso = draft.time ? new Date(draft.time).toISOString() : nowIso;

    const call: PortCall = {
      id: callId,
      vesselId: draft.vesselId,
      vesselName,
      type: draft.type,
      time: timeIso,
      portId: targetPortId,
      berthNo: draft.berthNo,
      iceKg: Number(draft.iceKg) || 0,
      fuelL: Number(draft.fuelL) || 0,
      unloadKg: Number(draft.unloadKg) || 0,
      visaStatus: draft.visaStatus,
      createdAt: nowIso,
    };

    // 事务内重新读库做最终核对：页面缓存的空闲/占用状态不作数
    const committed = await db.transaction('rw', db.calls, db.berths, async () => {
      const berth = await db.berths.where('portId').equals(targetPortId).filter((b) => b.berthNo === draft.berthNo).first();
      if (!berth) {
        throw new BerthConflictError('BERTH_NOT_FOUND', `泊位 ${draft.berthNo} 不存在，请重新选择泊位`);
      }

      if (draft.type === '进港') {
        if (berth.status !== '空闲') {
          const who = berth.status === '占用' ? berth.vesselName ?? '其他渔船' : '';
          const reason: BerthConflictReason = 'NOT_FREE_ON_ENTRY';
          const msg =
            berth.status === '占用'
              ? `泊位 ${draft.berthNo} 已被${who ? `「${who}」` : '别的船'}占用，请改选空闲泊位`
              : `泊位 ${draft.berthNo} 当前为维修状态，暂不可分配`;
          throw new BerthConflictError(reason, msg, berth.vesselName);
        }
        const nextBerth: Berth = {
          ...berth,
          status: '占用',
          vesselId: draft.vesselId,
          vesselName,
          entryCallId: callId,
          berthAt: call.time,
          leaveAt: null,
        };
        await db.calls.put(toPlain(call));
        await db.berths.put(toPlain(nextBerth));
        return { call, nextBerth };
      }

      // 出港：确认这条船正是泊位占用者
      if (berth.status !== '占用' || !berth.vesselId) {
        throw new BerthConflictError(
          'NOT_OCCUPIED_ON_EXIT',
          `泊位 ${draft.berthNo} 此刻并非占用状态（可能已被释放或已变更），请核对后重选`,
        );
      }
      if (berth.vesselId !== draft.vesselId) {
        // 找出本船当前实际占用的泊位，辅助值班员直接重选
        const own = await db.berths
          .where('vesselId')
          .equals(draft.vesselId)
          .filter((b) => b.status === '占用')
          .first();
        throw new BerthConflictError(
          'OCCUPIED_BY_OTHER',
          `泊位 ${draft.berthNo} 此刻由「${berth.vesselName ?? '其他渔船'}」占用，不是 ${vesselName}，请重选 ${vesselName} 的靠泊泊位`,
          berth.vesselName,
          own ? { portId: own.portId, berthNo: own.berthNo } : null,
        );
      }
      const nextBerth: Berth = {
        ...berth,
        status: '空闲',
        vesselId: null,
        vesselName: null,
        entryCallId: null,
        berthAt: null,
        leaveAt: call.time,
      };
      await db.calls.put(toPlain(call));
      await db.berths.put(toPlain(nextBerth));
      return { call, nextBerth };
    });

    calls.value = [...calls.value, committed.call];
    berths.value = berths.value.map((b) => (b.id === committed.nextBerth.id ? committed.nextBerth : b));
    return committed.call;
  }

  return {
    ports,
    berths,
    calls,
    loading,
    filter,
    filteredPorts,
    callsSorted,
    portById,
    berthsOf,
    berthByKey,
    activeBerthOfVessel,
    callsOfVessel,
    callsOfPort,
    resetFilter,
    loadAll,
    createPort,
    addBerth,
    setBerthStatus,
    updatePort,
    registerCall,
  };
});

/**
 * 订阅 IndexedDB 变更（含其他标签页 / 窗口的提交），泊位与流水实时回灌 store。
 * 值班员在旧页面停留时，别处一旦把空闲泊位分出去，本页下拉与网格立即反映最新占用。
 */
export function startPortRealtimeSync(): () => void {
  const berthSub = liveQuery(() => db.berths.toArray()).subscribe({
    next: (rows) => {
      usePortStore().berths = rows;
    },
    error: (err) => console.warn('[gbfishport] 泊位实时同步失败：', err),
  });
  const callSub = liveQuery(() => db.calls.toArray()).subscribe({
    next: (rows) => {
      usePortStore().calls = rows;
    },
    error: (err) => console.warn('[gbfishport] 流水实时同步失败：', err),
  });
  const portSub = liveQuery(() => db.ports.toArray()).subscribe({
    next: (rows) => {
      usePortStore().ports = rows;
    },
    error: (err) => console.warn('[gbfishport] 渔港实时同步失败：', err),
  });
  return () => {
    berthSub.unsubscribe();
    callSub.unsubscribe();
    portSub.unsubscribe();
  };
}
