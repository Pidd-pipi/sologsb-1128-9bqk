import type { FishingPort } from '../types/port';
import type { FishingVessel } from '../types/vessel';
import type { PortCall } from '../types/call';
import type { Berth } from '../types/berth';

/**
 * v4 迁移辅助：把 v3 及以前「流水不记渔港、泊位不记进港流水」的历史数据补成
 * 一一对应的绑定关系。历史流水没有 portId，只能按业务线索推断：
 * 1. 进港优先落到「当前仍被该船占用的同号泊位」（最可靠，现况即结果）；
 * 2. 其次落到船籍港名与渔港名相符、且存在同号泊位的渔港；
 * 3. 再次落到存在同号泊位的唯一渔港；
 * 4. 兜底第一座渔港，保证 portId 非空。
 */
export function resolveCallPortId(
  call: PortCall,
  ports: FishingPort[],
  berths: Berth[],
  vessels: FishingVessel[],
): string {
  if (call.portId) return call.portId;
  const candidates = ports.filter((p) => berths.some((b) => b.portId === p.id && b.berthNo === call.berthNo));
  if (candidates.length === 0) return ports[0]?.id ?? '';

  if (call.type === '进港') {
    const occupied = candidates.find((p) =>
      berths.some(
        (b) =>
          b.portId === p.id &&
          b.berthNo === call.berthNo &&
          b.status === '占用' &&
          b.vesselId === call.vesselId,
      ),
    );
    if (occupied) return occupied.id;
  }

  const vessel = vessels.find((v) => v.id === call.vesselId);
  if (vessel?.homePort) {
    const home = candidates.find((p) => p.name.includes(vessel.homePort));
    if (home) return home.id;
  }

  if (candidates.length === 1) return candidates[0].id;
  return ports[0]?.id ?? '';
}

/**
 * 回填占用泊位的 entryCallId：取该渔港内该船最近一次进港流水（且其泊位号一致）。
 */
export function resolveEntryCallId(berth: Berth, calls: PortCall[]): string | null {
  if (berth.status !== '占用' || !berth.vesselId) return null;
  const entry = calls
    .filter(
      (c) =>
        c.type === '进港' &&
        c.vesselId === berth.vesselId &&
        c.portId === berth.portId &&
        c.berthNo === berth.berthNo,
    )
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())[0];
  return entry?.id ?? null;
}
