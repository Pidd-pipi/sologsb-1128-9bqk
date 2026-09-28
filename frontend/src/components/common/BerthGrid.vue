<script setup lang="ts">
import { computed } from 'vue';
import type { Berth, BerthStatus } from '../../types/berth';
import { berthedDurationText, isOverstay } from '../../types/berth';
import { formatNumber } from '../../utils/format';

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
const CELL_H = 94;
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

/** 超过 48 小时滞留的占用泊位数（与列表 / 渔船档案读同一条占用记录） */
const overstayCount = computed(() => props.berths.filter((b) => isOverstay(b.berthAt)).length);

function cellAt(index: number): { x: number; y: number } {
  const row = Math.floor(index / props.perRow);
  const col = index % props.perRow;
  return { x: PAD + col * (CELL_W + GAP), y: PAD + row * (CELL_H + GAP) };
}

function strokeOf(berth: Berth): string {
  if (props.highlightBerthNo === berth.berthNo) return '#409eff';
  if (isOverstay(berth.berthAt)) return '#f56c6c';
  return COLORS[berth.status];
}

function strokeWidthOf(berth: Berth): number {
  if (props.highlightBerthNo === berth.berthNo) return 3;
  if (isOverstay(berth.berthAt)) return 2.2;
  return 1.5;
}

function tooltipOf(berth: Berth): string {
  const parts = [berth.berthNo, berth.status];
  if (berth.vesselName) parts.push(berth.vesselName);
  if (berth.status === '占用') {
    parts.push(`靠泊 ${berthedDurationText(berth.berthAt)}`);
    if (isOverstay(berth.berthAt)) parts.push('滞留超48小时');
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
          :fill="FILLS[berth.status]"
          :stroke="strokeOf(berth)"
          :stroke-width="strokeWidthOf(berth)"
          class="berth-grid__cell"
          :class="{ 'berth-grid__cell--selectable': selectable }"
          :data-testid="`berth-cell-${berth.berthNo}`"
          :data-berth-no="berth.berthNo"
          :data-status="berth.status"
          :data-overstay="isOverstay(berth.berthAt) ? 'true' : 'false'"
          @click="onSelect(berth)"
        >
          <title>{{ tooltipOf(berth) }}</title>
        </rect>
        <text
          :x="cellAt(index).x + 12"
          :y="cellAt(index).y + 24"
          class="berth-grid__no"
          :data-status="berth.status"
        >
          {{ berth.berthNo }}
        </text>
        <!-- 滞留角标 -->
        <g v-if="isOverstay(berth.berthAt)" :data-testid="`berth-overstay-${berth.berthNo}`">
          <rect
            :x="cellAt(index).x + CELL_W - 42"
            :y="cellAt(index).y + 8"
            width="34"
            height="16"
            rx="8"
            fill="#f56c6c"
          />
          <text
            :x="cellAt(index).x + CELL_W - 25"
            :y="cellAt(index).y + 20"
            class="berth-grid__badge"
            text-anchor="middle"
          >
            滞留
          </text>
        </g>
        <text
          :x="cellAt(index).x + 12"
          :y="cellAt(index).y + 44"
          class="berth-grid__meta"
        >
          {{ berth.status }} · 水深 {{ formatNumber(berth.designDepth) }}m
        </text>
        <text :x="cellAt(index).x + 12" :y="cellAt(index).y + 64" class="berth-grid__vessel">
          {{ berth.status === '占用' ? berth.vesselName || '未知船舶' : '—' }}
        </text>
        <text
          v-if="berth.status === '占用'"
          :x="cellAt(index).x + 12"
          :y="cellAt(index).y + 82"
          class="berth-grid__time"
          :class="{ 'berth-grid__time--overstay': isOverstay(berth.berthAt) }"
          :data-testid="`berth-duration-${berth.berthNo}`"
        >
          靠泊 {{ berthedDurationText(berth.berthAt) }}
        </text>
      </g>
    </svg>
    <div class="berth-grid__legend" data-testid="berth-grid-legend">
      <span v-for="item in legend" :key="item.status" class="berth-grid__legend-item">
        <i class="berth-grid__dot" :style="{ background: item.color }"></i>
        {{ item.status }} {{ item.count }}
      </span>
      <span v-if="overstayCount" class="berth-grid__legend-item berth-grid__legend-item--overstay" data-testid="berth-overstay-legend">
        <i class="berth-grid__dot" :style="{ background: '#f56c6c' }"></i>
        滞留超48小时 {{ overstayCount }}
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
  font-size: 11px;
  fill: #6b7c8c;
}
.berth-grid__vessel {
  font-size: 11px;
  fill: #3d5670;
}
.berth-grid__time {
  font-size: 10px;
  fill: #8592a0;
}
.berth-grid__time--overstay {
  font-weight: 700;
  fill: #f56c6c;
}
.berth-grid__badge {
  font-size: 9px;
  font-weight: 700;
  fill: #ffffff;
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
.berth-grid__legend-item--overstay {
  color: #f56c6c;
  font-weight: 600;
}
.berth-grid__dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
}
</style>
