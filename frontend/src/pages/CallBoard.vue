<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
import { usePortStore, BerthConflictError } from '../stores/portStore';
import { useVesselStore } from '../stores/vesselStore';
import { useLocalDraft } from '../hooks/useLocalDraft';
import { useBerthStatus } from '../hooks/useBerthStatus';
import BerthGrid from '../components/common/BerthGrid.vue';
import EmptyState from '../components/common/EmptyState.vue';
import type { Berth } from '../types/berth';
import { berthedDurationText, isOverstay } from '../types/berth';
import { CALL_TYPES, VISA_STATUSES, emptyCallDraft, type CallDraft } from '../types/call';
import { formatDateTime, formatNumber, isToday, nowLocalInputValue } from '../utils/format';

const router = useRouter();
const portStore = usePortStore();
const vesselStore = useVesselStore();

const { draft, restored, savedAt, storageKey, persist, restore, clearDraft } = useLocalDraft<CallDraft>('call-board', () => ({
  ...emptyCallDraft(),
  time: nowLocalInputValue(),
}));
const form = draft;

const formRef = ref<FormInstance>();
const submitting = ref(false);
const focusPortId = ref('');
/** 提交瞬间泊位状态已变化的冲突提示；草稿（渔船/时间/数量）保留，要求重选泊位 */
const conflictMessage = ref('');
const conflictQuick = ref<{ portId: string; berthNo: string } | null>(null);

const rules: FormRules = {
  vesselId: [{ required: true, message: '请选择渔船', trigger: 'change' }],
  portId: [{ required: true, message: '请选择泊位', trigger: 'change' }],
  berthNo: [{ required: true, message: '请选择泊位', trigger: 'change' }],
  time: [{ required: true, message: '请选择进出港时间', trigger: 'change' }],
};

const vesselOptions = computed(() => vesselStore.vessels);

const selectedVessel = computed(() => vesselStore.vesselById(form.value.vesselId));

/** 表单当前选中的泊位（store 中的最新状态，跨标签页提交后会即时变化） */
const selectedBerth = computed<Berth | undefined>(() =>
  form.value.portId && form.value.berthNo ? portStore.berthByKey(form.value.portId, form.value.berthNo) : undefined,
);

/** 出港时该渔船当前实际占用的泊位（同一笔进港占用，正常只有 1 个） */
const vesselOwnBerth = computed<Berth | undefined>(() =>
  form.value.vesselId ? portStore.activeBerthOfVessel(form.value.vesselId) : undefined,
);

/**
 * 可分配泊位：
 * - 进港：只列当下空闲泊位（旧页面缓存的空闲状态不作数，列表随实时数据刷新）
 * - 出港：只列所选渔船自己仍占用的泊位；没选渔船或该船不在港则为空
 */
const berthOptions = computed(() => {
  if (form.value.type === '进港') {
    return portStore.berths
      .filter((b) => b.status === '空闲')
      .map((b) => ({
        value: `${b.portId}|${b.berthNo}`,
        label: `${portStore.portById(b.portId)?.name ?? b.portId} · ${b.berthNo}`,
        portId: b.portId,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }
  if (form.value.vesselId) {
    return portStore.berths
      .filter((b) => b.status === '占用' && b.vesselId === form.value.vesselId)
      .map((b) => ({
        value: `${b.portId}|${b.berthNo}`,
        label: `${portStore.portById(b.portId)?.name ?? b.portId} · ${b.berthNo}`,
        portId: b.portId,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }
  return [];
});

const berthKey = computed({
  get: () => (form.value.portId && form.value.berthNo ? `${form.value.portId}|${form.value.berthNo}` : ''),
  set: (key: string) => {
    const [portId, berthNo] = String(key).split('|');
    form.value.portId = portId ?? '';
    form.value.berthNo = berthNo ?? '';
    focusPortId.value = portId ?? '';
    if (key) conflictMessage.value = '';
  },
});

const focusBerths = computed<Berth[]>(() =>
  focusPortId.value ? portStore.berthsOf(focusPortId.value) : [],
);

const { summary } = useBerthStatus(computed(() => portStore.berths), computed(() => focusPortId.value));
const berthRef = computed(() => portStore.berths);

const todayCalls = computed(() => portStore.callsSorted.filter((c) => isToday(c.time)));

const todayStats = computed(() => ({
  inbound: todayCalls.value.filter((c) => c.type === '进港').length,
  outbound: todayCalls.value.filter((c) => c.type === '出港').length,
  ice: todayCalls.value.reduce((sum, c) => sum + c.iceKg, 0),
  fuel: todayCalls.value.reduce((sum, c) => sum + c.fuelL, 0),
  unload: todayCalls.value.reduce((sum, c) => sum + c.unloadKg, 0),
}));

/** 选中泊位相对当前表单是否已失效（页面上的旧状态与库内最新状态不一致） */
const berthStale = computed<boolean>(() => {
  const berth = selectedBerth.value;
  if (!berth) return Boolean(form.value.berthNo);
  if (form.value.type === '进港') return berth.status !== '空闲';
  return berth.status !== '占用' || berth.vesselId !== form.value.vesselId;
});

const berthHint = computed<{ type: 'info' | 'warning' | 'danger'; text: string } | null>(() => {
  if (!form.value.vesselId && form.value.type === '出港') {
    return { type: 'info', text: '请先选择渔船，再选择该船占用的泊位办理出港' };
  }
  const berth = selectedBerth.value;
  if (!berth) {
    if (form.value.type === '出港' && form.value.vesselId && !vesselOwnBerth.value) {
      return { type: 'warning', text: '该渔船当前没有占用中的泊位，无法办理出港；如确需补录，请先办理进港登记' };
    }
    return null;
  }
  if (form.value.type === '进港') {
    if (berth.status === '占用') {
      return { type: 'danger', text: `泊位已被「${berth.vesselName ?? '别的船'}」占用，请改选其他空闲泊位` };
    }
    if (berth.status === '维修') {
      return { type: 'danger', text: '该泊位处于维修状态，暂不可分配' };
    }
    return { type: 'info', text: '泊位当下为空闲，提交时会再次核对并与进港记录一并锁定' };
  }
  if (berth.status !== '占用' || berth.vesselId !== form.value.vesselId) {
    return {
      type: 'danger',
      text:
        berth.status !== '占用'
          ? '该泊位此刻已不是占用状态，请重选该船的靠泊泊位'
          : `该泊位此刻由「${berth.vesselName ?? '其他渔船'}」占用，不是所选渔船，请重选`,
    };
  }
  const duration = berthedDurationText(berth.berthAt);
  if (isOverstay(berth.berthAt)) {
    return { type: 'danger', text: `占用核对一致：已靠泊 ${duration}，超过 48 小时，出港时请同步处理滞留` };
  }
  return { type: 'info', text: `占用核对一致：该船已靠泊 ${duration}` };
});

function hasContent(value: CallDraft): boolean {
  return (
    Boolean(value.vesselId) ||
    Boolean(value.berthNo) ||
    Boolean(value.portId) ||
    Number(value.iceKg) > 0 ||
    Number(value.fuelL) > 0 ||
    Number(value.unloadKg) > 0
  );
}

onMounted(async () => {
  if (!portStore.ports.length) await portStore.loadAll();
  if (!vesselStore.vessels.length) await vesselStore.loadAll();
  if (restore()) {
    if (hasContent(form.value)) {
      ElMessage.info(`已恢复本地草稿（保存于 ${formatDateTime(savedAt.value)}）`);
    } else {
      // 空草稿没有恢复价值，直接清掉，避免误报「已恢复草稿」
      clearDraft();
    }
  }
  reconcileBerthSelection();
  if (form.value.portId) focusPortId.value = form.value.portId;
});

watch(
  () => form.value,
  (value) => {
    // 只有存在有效输入时才落草稿；提交后表单被重置，草稿同步清空
    if (hasContent(value)) persist();
    else clearDraft();
  },
  { deep: true },
);

watch(
  () => form.value.type,
  () => {
    // 进出港类型切换后旧泊位必然不再适用，清空等待重选
    form.value.portId = '';
    form.value.berthNo = '';
    conflictMessage.value = '';
    reconcileBerthSelection();
  },
);

watch(
  () => form.value.vesselId,
  () => {
    conflictMessage.value = '';
    // 切换渔船后占用关系随之改变：清掉不属于新船的泊位，出港再自动带出本船泊位
    if (form.value.berthNo) {
      const berth = form.value.portId
        ? portStore.berthByKey(form.value.portId, form.value.berthNo)
        : undefined;
      if (form.value.type === '进港' || !berth || berth.vesselId !== form.value.vesselId) {
        form.value.portId = '';
        form.value.berthNo = '';
      }
    }
    reconcileBerthSelection();
  },
);

// 泊位数据被其他标签页改动后，若已选泊位失效，给出醒目提示（草稿仍保留）
watch(
  berthRef,
  () => {
    if (form.value.berthNo && berthStale.value && !conflictMessage.value) {
      conflictMessage.value = '泊位状态刚刚发生变化，请按最新占用情况重选泊位';
    }
  },
  { deep: true },
);

/**
 * 按当前类型与渔船校正泊位选择：
 * 出港自动带出该船占用的泊位（仍校验归属）；进港不预选，避免把旧空闲状态直接提交。
 */
function reconcileBerthSelection(): void {
  if (form.value.type === '出港' && form.value.vesselId) {
    const own = portStore.activeBerthOfVessel(form.value.vesselId);
    if (own && (!form.value.berthNo || form.value.berthNo !== own.berthNo || form.value.portId !== own.portId)) {
      form.value.portId = own.portId;
      form.value.berthNo = own.berthNo;
      focusPortId.value = own.portId;
    }
  }
}

/** 泊位格点选：进港只能选当下空闲格，出港只能选本船占用格 */
function selectBerth(berth: Berth): void {
  if (form.value.type === '进港') {
    if (berth.status !== '空闲') {
      ElMessage.warning(`${berth.berthNo} ${berth.status === '占用' ? `已被「${berth.vesselName ?? '别的船'}」占用` : '处于维修状态'}，请选择空闲泊位`);
      return;
    }
  } else if (!form.value.vesselId) {
    ElMessage.warning('请先选择渔船');
    return;
  } else if (berth.status !== '占用' || berth.vesselId !== form.value.vesselId) {
    ElMessage.warning(`出港必须选择 ${selectedVessel.value?.name ?? '该船'} 当前占用的泊位`);
    return;
  }
  berthKey.value = `${berth.portId}|${berth.berthNo}`;
  ElMessage.info(`已选择 ${portStore.portById(berth.portId)?.name ?? berth.portId} · ${berth.berthNo}`);
}

async function submit(): Promise<void> {
  if (!formRef.value) return;
  const valid = await formRef.value.validate().catch(() => false);
  if (!valid) return;
  if (!selectedVessel.value) {
    ElMessage.warning('请选择有效的渔船');
    return;
  }
  // 提交前最后一道前端核对（store 事务内还会以库内最新状态复查一次）
  if (berthStale.value) {
    conflictMessage.value = berthHint.value?.text ?? '泊位状态已变化，请重选泊位';
    ElMessage.error('泊位状态已变化，请重选泊位后再提交（已填写内容已保留为草稿）');
    return;
  }
  submitting.value = true;
  try {
    const payload: CallDraft = {
      vesselId: form.value.vesselId,
      type: form.value.type,
      time: form.value.time,
      portId: form.value.portId,
      berthNo: form.value.berthNo,
      iceKg: Number(form.value.iceKg) || 0,
      fuelL: Number(form.value.fuelL) || 0,
      unloadKg: Number(form.value.unloadKg) || 0,
      visaStatus: form.value.visaStatus,
    };
    const call = await portStore.registerCall(payload, selectedVessel.value.name);
    ElMessage.success(`已登记 ${call.vesselName} ${call.type} · 泊位 ${call.berthNo}`);
    clearDraft();
    conflictMessage.value = '';
    conflictQuick.value = null;
    Object.assign(form.value, {
      ...emptyCallDraft(),
      time: nowLocalInputValue(),
    });
    focusPortId.value = '';
  } catch (error) {
    if (error instanceof BerthConflictError) {
      // 状态在提交瞬间被别人改掉：保留渔船/时间/数量等草稿，只清掉泊位并要求重选
      conflictMessage.value = error.message;
      conflictQuick.value = error.vesselBerth;
      form.value.portId = '';
      form.value.berthNo = '';
      focusPortId.value = conflictQuick.value?.portId ?? '';
      persist();
      ElMessage.error('泊位状态已变化，登记未提交，已为你保留草稿，请重选泊位');
    } else {
      ElMessage.error(`登记失败：${(error as Error).message}`);
    }
  } finally {
    submitting.value = false;
  }
}

/** 冲突提示里“跳到本船泊位”的快捷操作 */
function useConflictQuick(): void {
  if (!conflictQuick.value) return;
  form.value.portId = conflictQuick.value.portId;
  form.value.berthNo = conflictQuick.value.berthNo;
  focusPortId.value = conflictQuick.value.portId;
  conflictMessage.value = '';
}

function resetDraft(): void {
  clearDraft();
  Object.assign(form.value, { ...emptyCallDraft(), time: nowLocalInputValue() });
  conflictMessage.value = '';
  conflictQuick.value = null;
  focusPortId.value = '';
  ElMessage.success('草稿已清空');
}

function openVessel(vesselId: string): void {
  void router.push(`/vessels/${vesselId}`);
}
</script>

<template>
  <section class="page">
    <header class="page__head">
      <div>
        <h1>进出港登记</h1>
        <p class="page__sub">
          进港前核对泊位当下为空并把渔船、时间与泊位写入同一条记录；出港前确认本船正是泊位占用者，泊位状态变动时保留草稿并提示重选
        </p>
      </div>
    </header>

    <el-alert
      v-if="restored && !conflictMessage"
      type="info"
      show-icon
      :closable="false"
      title="已从浏览器本地草稿恢复未提交的表单"
      data-testid="draft-alert"
      class="draft-alert"
    >
      <template #default>
        草稿保存在 localStorage（键 {{ storageKey }}），提交成功后会清空。
      </template>
    </el-alert>

    <el-alert
      v-if="conflictMessage"
      type="error"
      show-icon
      :closable="false"
      data-testid="berth-conflict-alert"
      class="draft-alert"
    >
      <template #title>{{ conflictMessage }}</template>
      <template #default>
        渔船、时间与加冰/加油/卸货等内容已保留为草稿，请重选泊位后重新提交。
        <el-button
          v-if="conflictQuick"
          type="danger"
          size="small"
          text
          data-testid="conflict-jump-berth"
          @click="useConflictQuick"
        >
          选择该船当前泊位 {{ conflictQuick.berthNo }}
        </el-button>
      </template>
    </el-alert>

    <el-row :gutter="16">
      <el-col :lg="13" :md="24">
        <el-card shadow="never" class="detail-card">
          <template #header><span class="card-title">登记表单</span></template>
          <el-form ref="formRef" :model="form" :rules="rules" label-width="110px" data-testid="call-form">
            <el-form-item label="渔船" prop="vesselId">
              <el-select id="call-vessel" v-model="form.vesselId" placeholder="请选择渔船" filterable style="width: 100%">
                <el-option
                  v-for="v in vesselOptions"
                  :key="v.id"
                  :label="`${v.name}（${v.homePort} · ${formatNumber(v.enginePower, 0)}kW）`"
                  :value="v.id"
                />
              </el-select>
            </el-form-item>

            <el-form-item label="进出港类型" prop="type">
              <el-radio-group v-model="form.type" data-testid="call-type">
                <el-radio-button v-for="t in CALL_TYPES" :key="t" :value="t">{{ t }}</el-radio-button>
              </el-radio-group>
            </el-form-item>

            <el-form-item label="时间" prop="time">
              <el-date-picker
                id="call-time"
                v-model="form.time"
                type="datetime"
                value-format="YYYY-MM-DDTHH:mm"
                placeholder="选择时间"
                style="width: 100%"
              />
            </el-form-item>

            <el-form-item label="泊位" prop="portId">
              <el-select
                id="call-berth"
                v-model="berthKey"
                :placeholder="
                  form.type === '进港'
                    ? '选择当下空闲泊位'
                    : form.vesselId
                      ? '选择本船占用泊位'
                      : '请先选择渔船'
                "
                style="width: 100%"
                data-testid="call-berth"
              >
                <el-option v-for="opt in berthOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
              </el-select>
              <p v-if="berthHint" class="berth-hint" :class="`berth-hint--${berthHint.type}`" data-testid="berth-hint">
                {{ berthHint.text }}
              </p>
            </el-form-item>

            <el-row :gutter="12">
              <el-col :span="8">
                <el-form-item label="加冰 kg" prop="iceKg">
                  <el-input-number id="call-ice" v-model="form.iceKg" :min="0" :max="20000" :step="50" style="width: 100%" />
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="加油 L" prop="fuelL">
                  <el-input-number id="call-fuel" v-model="form.fuelL" :min="0" :max="20000" :step="50" style="width: 100%" />
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="卸货量 kg" prop="unloadKg">
                  <el-input-number id="call-unload" v-model="form.unloadKg" :min="0" :max="200000" :step="100" style="width: 100%" />
                </el-form-item>
              </el-col>
            </el-row>

            <el-form-item label="签证状态" prop="visaStatus">
              <el-select id="call-visa" v-model="form.visaStatus" style="width: 100%">
                <el-option v-for="s in VISA_STATUSES" :key="s" :label="s" :value="s" />
              </el-select>
            </el-form-item>

            <el-form-item>
              <el-button
                type="primary"
                :loading="submitting"
                :disabled="berthStale"
                data-testid="submit-call"
                @click="submit"
              >
                保存登记
              </el-button>
              <el-button data-testid="clear-draft" @click="resetDraft">清空草稿</el-button>
              <el-button v-if="selectedVessel" text type="primary" @click="openVessel(selectedVessel.id)">查看渔船档案</el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>

      <el-col :lg="11" :md="24">
        <el-card shadow="never" class="detail-card">
          <template #header>
            <span class="card-title">今日统计</span>
          </template>
          <div class="stat-row">
            <div class="stat"><span class="stat__label">进港</span><b>{{ todayStats.inbound }}</b></div>
            <div class="stat"><span class="stat__label">出港</span><b>{{ todayStats.outbound }}</b></div>
            <div class="stat"><span class="stat__label">加冰 kg</span><b>{{ formatNumber(todayStats.ice, 0) }}</b></div>
            <div class="stat"><span class="stat__label">加油 L</span><b>{{ formatNumber(todayStats.fuel, 0) }}</b></div>
            <div class="stat"><span class="stat__label">卸货 kg</span><b>{{ formatNumber(todayStats.unload, 0) }}</b></div>
          </div>
        </el-card>

        <el-card shadow="never" class="detail-card">
          <template #header>
            <span class="card-title">
              泊位占用网格{{ focusPortId ? ` · ${portStore.portById(focusPortId)?.name ?? ''}` : '（选择泊位后聚焦对应渔港）' }}
            </span>
          </template>
          <BerthGrid v-if="focusBerths.length" :berths="focusBerths" @select="selectBerth" />
          <EmptyState v-else title="尚未选择渔港泊位" description="在左侧表单选择泊位，或直接点击泊位网格中的方块。">
            <el-button type="primary" @click="focusPortId = portStore.ports[0]?.id ?? ''">聚焦第一座渔港</el-button>
          </EmptyState>
          <p v-if="focusBerths.length" class="detail-hint">
            占用率 {{ (summary.occupancyRate * 100).toFixed(1) }}% · 占用 {{ summary.occupied }} · 空闲 {{ summary.free }} · 维修 {{ summary.maintenance }}
            <template v-if="summary.overstayCount">
              · <span class="overstay-text">滞留超48小时 {{ summary.overstayCount }}</span>
            </template>
          </p>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" class="detail-card">
      <template #header><span class="card-title">今日流水（{{ todayCalls.length }} 条）</span></template>
      <el-table :data="todayCalls" size="small" border empty-text="今日暂无进出港流水" data-testid="today-calls">
        <el-table-column prop="vesselName" label="船名" min-width="120" />
        <el-table-column prop="type" label="类型" width="70" />
        <el-table-column label="渔港" min-width="120">
          <template #default="scope">{{ portStore.portById(scope.row.portId)?.name ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="时间" min-width="150">
          <template #default="scope">{{ formatDateTime(scope.row.time) }}</template>
        </el-table-column>
        <el-table-column prop="berthNo" label="泊位号" width="80" />
        <el-table-column label="加冰 kg" min-width="90">
          <template #default="scope">{{ formatNumber(scope.row.iceKg, 0) }}</template>
        </el-table-column>
        <el-table-column label="加油 L" min-width="90">
          <template #default="scope">{{ formatNumber(scope.row.fuelL, 0) }}</template>
        </el-table-column>
        <el-table-column label="卸货 kg" min-width="100">
          <template #default="scope">{{ formatNumber(scope.row.unloadKg, 0) }}</template>
        </el-table-column>
        <el-table-column prop="visaStatus" label="签证状态" width="100" />
      </el-table>
    </el-card>
  </section>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.page__head h1 {
  margin: 0;
  font-size: 22px;
  color: #17324d;
}
.page__sub {
  margin: 6px 0 0;
  font-size: 13px;
  color: #6b7c8c;
}
.detail-card {
  border-radius: 10px;
  margin-bottom: 16px;
}
.card-title {
  font-weight: 600;
  color: #17324d;
}
.draft-alert {
  border-radius: 10px;
}
.berth-hint {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.5;
}
.berth-hint--info {
  color: #7b8a99;
}
.berth-hint--warning {
  color: #e6a23c;
}
.berth-hint--danger {
  color: #f56c6c;
  font-weight: 600;
}
.overstay-text {
  color: #f56c6c;
  font-weight: 600;
}
.stat-row {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.stat__label {
  font-size: 12px;
  color: #7b8a99;
}
.stat b {
  font-size: 18px;
  color: #17324d;
}
.detail-hint {
  margin: 10px 0 0;
  font-size: 12px;
  color: #6b7c8c;
}
</style>
