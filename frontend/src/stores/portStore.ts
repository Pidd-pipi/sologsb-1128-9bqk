import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { db } from '../db';
import { toPlain, uid } from '../utils/format';
import { emptyPortFilter, type FishingPort, type PortFilter, type SupplyCapability } from '../types/port';
import type { Berth, BerthStatus } from '../types/berth';
import type { CallDraft, PortCall } from '../types/call';
import { buildBerthRecords } from '../db/berth';

/** 泊位冲突原因：提交瞬间泊位现状与表单依据不一致 */
export type BerthConflictKind =
  /** 进港：目标泊位不存在 */
  | 'berth-missing'
  /** 进港：泊位已不是空闲（被别的船占用或转维修） */
  | 'berth-not-free'
  /** 进港：该船已在别处占用泊位 */
  | 'vessel-already-in'
  /** 出港：目标泊位未被占用 */
  | 'berth-not-occupied'
  /** 出港：占用者不是当前这条船（交接班把别的船占用的泊位分了过来） */
  | 'occupier-mismatch';

export class BerthConflictError extends Error {
  kind: BerthConflictKind;

  constructor(kind: BerthConflictKind, message: string) {
    super(message);
    this.name = 'BerthConflictError';
    this.kind = kind;
  }
}

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

/** 提交瞬间按库中现状复核泊位，冲突直接抛错（事务随之中止，什么都不写） */
function assertBerthAllowed(berth: Berth | undefined, draft: CallDraft, occupiedByVessel: boolean): void {
  if (draft.type === '进港') {
    if (!berth) {
      throw new BerthConflictError('berth-missing', `泊位 ${draft.berthNo} 不存在，请重新选择泊位`);
    }
    if (berth.status !== '空闲') {
      throw new BerthConflictError(
        'berth-not-free',
        `泊位 ${berth.berthNo} 刚被${berth.status === '维修' ? '置为维修' : berth.vesselName ? `「${berth.vesselName}」` : '别的船'}占用，请改选空闲泊位`,
      );
    }
    if (occupiedByVessel) {
      throw new BerthConflictError('vessel-already-in', '该渔船已在港占用泊位，请先办理出港后再登记进港');
    }
    return;
  }

  if (!berth || berth.status !== '占用') {
    throw new BerthConflictError('berth-not-occupied', `泊位 ${draft.berthNo} 当前并非占用状态，请重新选择泊位`);
  }
  if (berth.vesselId !== draft.vesselId) {
    throw new BerthConflictError(
      'occupier-mismatch',
      `泊位 ${berth.berthNo} 的占用者是「${berth.vesselName ?? '别的船'}」，不是当前渔船，请重新选择泊位`,
    );
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

  /** 某渔港的进出港流水（与泊位占用同库同源） */
  function callsOfPort(portId: string): PortCall[] {
    return callsSorted.value.filter((c) => c.portId === portId);
  }

  function callsOfVessel(vesselId: string): PortCall[] {
    return callsSorted.value.filter((c) => c.vesselId === vesselId);
  }

  /** 该渔船当前占用的泊位（同一条船至多一条占用记录） */
  function occupiedBerthOfVessel(vesselId: string): Berth | undefined {
    return berths.value.find((b) => b.status === '占用' && b.vesselId === vesselId);
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

  /** 仅重拉泊位与流水：交接班后别的标签页 / 值班员可能已改动占用状态 */
  async function refreshOccupancy(): Promise<void> {
    const [b, c] = await Promise.all([db.berths.toArray(), db.calls.toArray()]);
    berths.value = b;
    calls.value = c;
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
      berthAt: null,
      leaveAt: null,
      entryCallId: null,
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
      berthAt: status === '占用' ? hit.berthAt ?? new Date().toISOString() : hit.berthAt,
      leaveAt: status === '空闲' ? new Date().toISOString() : null,
      // 人工改状态不经过进出港登记，进港流水关联随之解除
      entryCallId: status === '占用' ? hit.entryCallId : null,
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
   * 登记进出港并同步泊位占用：渔船、时间、渔港与泊位写进同一条流水，
   * 同时更新泊位占用，二者在同一个 Dexie 事务内完成。
   * 提交前直接读库复核泊位现状——页面上显示的空闲状态可能是交接班前的旧状态，
   * 一旦状态已变（泊位被别的船占用 / 占用者不是本船），事务中止、抛出 BerthConflictError，
   * 调用方应保留草稿并提示重新选择泊位。
   */
  async function registerCall(draft: CallDraft, vesselName: string): Promise<PortCall> {
    const call: PortCall = {
      id: uid('c'),
      vesselId: draft.vesselId,
      vesselName,
      type: draft.type,
      time: draft.time ? new Date(draft.time).toISOString() : new Date().toISOString(),
      portId: draft.portId,
      berthNo: draft.berthNo,
      iceKg: Number(draft.iceKg) || 0,
      fuelL: Number(draft.fuelL) || 0,
      unloadKg: Number(draft.unloadKg) || 0,
      visaStatus: draft.visaStatus,
      createdAt: new Date().toISOString(),
    };

    await db.transaction('rw', db.calls, db.berths, async () => {
      // 以库中现状为准，不信任内存里可能过期的状态（旧页面上的空闲/占用跟着提交）
      const freshBerth = await db.berths.get(`${draft.portId}-${draft.berthNo}`);
      const occupiedHere = await db.berths
        .where('vesselId')
        .equals(draft.vesselId)
        .filter((b) => b.status === '占用')
        .first();
      assertBerthAllowed(freshBerth, draft, Boolean(occupiedHere));

      await db.calls.put(toPlain(call));

      const nextBerth: Berth =
        draft.type === '进港'
          ? {
              ...(freshBerth as Berth),
              status: '占用',
              vesselId: draft.vesselId,
              vesselName,
              berthAt: call.time,
              leaveAt: null,
              entryCallId: call.id,
            }
          : {
              ...(freshBerth as Berth),
              status: '空闲',
              vesselId: null,
              vesselName: null,
              berthAt: null,
              leaveAt: call.time,
              entryCallId: null,
            };
      await db.berths.put(toPlain(nextBerth));
    });

    // 事务提交成功后再刷新内存，冲突时保持原状
    await refreshOccupancy();
    return call;
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
    callsOfPort,
    callsOfVessel,
    occupiedBerthOfVessel,
    resetFilter,
    loadAll,
    refreshOccupancy,
    createPort,
    addBerth,
    setBerthStatus,
    updatePort,
    registerCall,
  };
});
