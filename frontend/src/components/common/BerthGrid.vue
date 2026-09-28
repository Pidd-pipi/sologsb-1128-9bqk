<script setup lang="ts">
import { computed } from 'vue';
import type { Berth, BerthStatus } from '../../types/berth';
import { DETENTION_HOURS } from '../../types/berth';
import { formatDateTime, formatNumber } from '../../utils/format';
import { durationShort, isDetained } from '../../utils/occupancy';

const props = withDefaults(
  defineProps<{
    berths: Berth[];
    perRow?: number;
    selectable?: boolean;
    highlightBerthNo?: string;
  }>(),
  { perRow: 4, selectable: true, highlightBerthNo: '' },
);

const emit = defineEmits<{ (e: 'select', berth: Berth): void }>();

const CELL_W = 120;
const CELL_H = 78;
const GAP = 12;
const PAD = 14;

const COLORS: Record<BerthStatus, string> = {
  空闲: '#67c23a',
  占用: '#e6a23c',
  维修: '#909399',
};

const FILLS: Record<BerthStatus, string> = {
  空闲: '#f0f9eb',
  占用: '#fdf6ec',
  维修: '#f4f4f5',
};

const rows = computed(() => Math.max(1, Math.ceil(props.berths.length / props.perRow)));
const width = computed(() => PAD * 2 + props.perRow * CELL_W + (props.perRow - 1) * GAP);
const height = computed(() => PAD * 2 + rows.value * CELL_H + (rows.value - 1) * GAP);

const legend = computed(() =>
  (['空闲', '占用', '维修'] as BerthStatus[]).map((status) => ({
    status,
    color: COLORS[status],
    count: props.berths.filter((b) => b.status === status).length,
  })),
);

/** 超 48 小时滞留的占用泊位数（与渔港详情、渔船档案同一口径） */
const detainedCount = computed(
  () => props.berths.filter((b) => b.status === '占用' && isDetained(b.berthAt)).length,
);

function cellAt(index: number): { x: number; y: number } {
  const row = Math.floor(index / props.perRow);
  const col = index % props.perRow;
  return { x: PAD + col * (CELL_W + GAP), y: PAD + row * (CELL_H + GAP) };
}

function strokeColor(berth: Berth): string {
  if (berth.status === '占用' && isDetained(berth.berthAt)) return '#f56c6c';
  if (props.highlightBerthNo === berth.berthNo) return '#409eff';
  return COLORS[berth.status];
}

function strokeWidth(berth: Berth): number {
  if (berth.status === '占用' && isDetained(berth.berthAt)) return 2.5;
  return props.highlightBerthNo === berth.berthNo ? 3 : 1.5;
}

function cellTitle(berth: Berth): string {
  const parts = [`${berth.berthNo} · ${berth.status}`];
  if (berth.status === '占用') {
    parts.push(berth.vesselName || '未知船舶');
    parts.push(`靠泊自 ${formatDateTime(berth.berthAt)}`);
    if (isDetained(berth.berthAt)) parts.push(`已滞留（超过 ${DETENTION_HOURS} 小时）`);
  } else {
    parts.push(`水深 ${formatNumber(berth.designDepth)}m`);
  }
  return parts.join(' · ');
}

function onSelect(berth: Berth): void {
  if (props.selectable) emit('select', berth);
}
</script>

<template>
  <div class="berth-grid" data-testid="berth-grid">
    <svg
      class="berth-grid__svg"
      :viewBox="`0 0 ${width} ${height}`"
      role="img"
      aria-label="泊位占用网格"
    >
      <g v-for="(berth, index) in berths" :key="berth.id">
        <rect
          :x="cellAt(index).x"
          :y="cellAt(index).y"
          :width="CELL_W"
          :height="CELL_H"
          rx="10"
          :fill="berth.status === '占用' && isDetained(berth.berthAt) ? '#fef0f0' : FILLS[berth.status]"
          :stroke="strokeColor(berth)"
          :stroke-width="strokeWidth(berth)"
          class="berth-grid__cell"
          :class="{ 'berth-grid__cell--selectable': selectable }"
          :data-testid="`berth-cell-${berth.berthNo}`"
          :data-berth-no="berth.berthNo"
          :data-status="berth.status"
          :data-detained="berth.status === '占用' && isDetained(berth.berthAt) ? 'true' : 'false'"
          @click="onSelect(berth)"
        >
          <title>{{ cellTitle(berth) }}</title>
        </rect>
        <text
          :x="cellAt(index).x + 12"
          :y="cellAt(index).y + 26"
          class="berth-grid__no"
          :data-status="berth.status"
        >
          {{ berth.berthNo }}
        </text>
        <!-- 占用格显示靠泊起始时间（与渔港详情、渔船档案同一笔泊位记录） -->
        <text v-if="berth.status === '占用'" :x="cellAt(index).x + 12" :y="cellAt(index).y + 45" class="berth-grid__meta">
          {{ formatDateTime(berth.berthAt) }}
        </text>
        <text v-else :x="cellAt(index).x + 12" :y="cellAt(index).y + 46" class="berth-grid__meta">
          {{ berth.status }} · 水深 {{ formatNumber(berth.designDepth) }}m
        </text>
        <text :x="cellAt(index).x + 12" :y="cellAt(index).y + 63" class="berth-grid__vessel">
          {{ berth.status === '占用' ? berth.vesselName || '未知船舶' : '—' }}
        </text>
        <text
          v-if="berth.status === '占用' && durationShort(berth.berthAt)"
          :x="cellAt(index).x + CELL_W - 10"
          :y="cellAt(index).y + 63"
          text-anchor="end"
          class="berth-grid__duration"
          :class="{ 'berth-grid__duration--detained': isDetained(berth.berthAt) }"
          :data-testid="`berth-duration-${berth.berthNo}`"
        >
          {{ isDetained(berth.berthAt) ? `滞留 ${durationShort(berth.berthAt)}` : durationShort(berth.berthAt) }}
        </text>
      </g>
    </svg>
    <div class="berth-grid__legend" data-testid="berth-grid-legend">
      <span v-for="item in legend" :key="item.status" class="berth-grid__legend-item">
        <i class="berth-grid__dot" :style="{ background: item.color }"></i>
        {{ item.status }} {{ item.count }}
      </span>
      <span v-if="detainedCount > 0" class="berth-grid__legend-item" data-testid="berth-grid-detained">
        <i class="berth-grid__dot berth-grid__dot--detained"></i>
        滞留（&gt;{{ DETENTION_HOURS }}h）{{ detainedCount }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.berth-grid {
  width: 100%;
}
.berth-grid__svg {
  width: 100%;
  height: auto;
  background: #ffffff;
  border: 1px solid #e4ecf3;
  border-radius: 10px;
}
.berth-grid__cell--selectable {
  cursor: pointer;
}
.berth-grid__cell--selectable:hover {
  filter: brightness(0.97);
}
.berth-grid__no {
  font-size: 14px;
  font-weight: 700;
  fill: #17324d;
}
.berth-grid__meta {
  font-size: 10px;
  fill: #6b7c8c;
}
.berth-grid__vessel {
  font-size: 11px;
  fill: #3d5670;
}
.berth-grid__duration {
  font-size: 10px;
  font-weight: 600;
  fill: #b88230;
}
.berth-grid__duration--detained {
  fill: #f56c6c;
}
.berth-grid__legend {
  display: flex;
  gap: 16px;
  margin-top: 8px;
  font-size: 12px;
  color: #5b6b7b;
}
.berth-grid__legend-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.berth-grid__dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
}
.berth-grid__dot--detained {
  background: #f56c6c;
}
</style>
