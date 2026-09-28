# 渔港与渔船档案地图（sologsb-1128 / gbfishport）

面向渔港管理站、渔业合作社与船东的**纯前端单页应用**：把渔港泊位条件、渔船技术档案与进出港动态集中到一张图上核对。
支持登记泊位与补给能力、建立含主机功率与吨位的渔船档案、记录进出港与泊位占用。

## 一键启动（Docker Compose）

```bash
cp .env.example .env
docker compose up -d --build
```

启动后访问：<http://localhost:21828>

停止：

```bash
docker compose down
```

## 技术栈

| 分类 | 选型 |
| --- | --- |
| 框架 | Vue 3（`<script setup>` + TypeScript） |
| 构建 | Vite 5 |
| UI | Element Plus 2 |
| 状态 | Pinia |
| 路由 | Vue Router 4（history 模式，nginx `try_files` 兜底） |
| 本地存储 | IndexedDB（Dexie 4，库名 `gbfishport-db`）+ localStorage（表单草稿） |
| 地图 | 高德地图 JS API（`VITE_AMAP_KEY`），未配置 key 时降级为本地 SVG 网格视图 |
| 托管 | nginx:alpine（gzip + 前端路由回退） |

## 目录结构

```
sologsb-1128/
├── docker-compose.yml          # 无 version 字段；顶层 name: gbfishport
├── .env / .env.example         # COMPOSE_PROJECT_NAME / FRONTEND_PORT / VITE_AMAP_KEY
├── frontend/
│   ├── Dockerfile              # node:20-alpine 构建 → nginx:alpine 托管
│   ├── nginx.conf              # try_files $uri $uri/ /index.html + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/              # port.ts / vessel.ts / call.ts / berth.ts（4 个数据模型）
│       ├── stores/             # portStore.ts / vesselStore.ts / uiStore.ts
│       ├── db/                 # index.ts（Dexie v1→v3 迁移）/ berth.ts / seed.ts
│       ├── components/common/  # PortCard / BerthGrid / VesselSpecTable / MapPanel / EmptyState
│       ├── hooks/              # useAmapLoader / useBerthStatus / useLocalDraft
│       ├── pages/              # PortList / PortDetail / VesselList / VesselDetail / CallBoard / MapView
│       ├── router/index.ts
│       └── utils/              # tonnage.ts / geo.ts / format.ts
└── README.md
```

## 页面与路由

| 路由 | 说明 | 消费模型 |
| --- | --- | --- |
| `/` | 渔港一览：卡片展示等级、泊位数、在港船数、占用率与滞留数，支持按等级与避风能力筛选 | FishingPort、Berth、PortCall |
| `/ports/:id` | 渔港详情：基本信息与补给能力、SVG 泊位网格（点击查看占用船舶与靠泊时长）、按船显示靠泊起始时间、48 小时滞留提示与近日流水 | 四个模型 |
| `/vessels` | 渔船检索：按作业类型、主机功率区间、总吨位与船籍港组合查询 | FishingVessel |
| `/vessels/:id` | 渔船档案详情：主尺度、主机功率、作业类型、证书有效期、当前泊位（含靠泊时长/滞留标记）与进出港时间线 | FishingVessel、PortCall、Berth |
| `/calls` | 进出港登记：进港只分配当下空闲泊位，出港只认本船占用泊位；提交瞬间复查泊位状态，冲突时保留草稿并提示重选 | PortCall、Berth、FishingVessel |
| `/map` | 渔港与在港渔船分布：高德 JS API 标记，未配置 key 时为 SVG 网格视图，点选弹出泊位占用摘要（含滞留） | FishingPort、Berth |

## 进出港登记与泊位占用绑定

交接时旧页面可能仍把已被别的船占用的泊位当成空闲，登记逻辑因此做了三层防护：

- **同一笔记录**：进港登记把渔船、时间与渔港+泊位写入一条 `PortCall`，泊位占用记录（`Berth`）通过 `entryCallId` 反向指向这条进港流水；出港登记写流水与释放泊位在同一个 Dexie 事务内完成，失败一起回滚。
- **提交瞬间复查**：进港前事务内重新读库核对泊位当下为「空闲」；出港前核对该泊位此刻由本船占用（`vesselId` + `entryCallId` 双重确认）。泊位已被别人占用、已被释放或处于维修时抛 `BerthConflictError`，**渔船、时间、加冰/加油/卸货等草稿保留**，仅清空泊位并醒目提示重选（出港冲突还会带出该船当前实际泊位的快捷入口）。
- **实时状态**：`liveQuery` 订阅 IndexedDB 变更，其他标签页的登记会即时刷新本页泊位下拉与网格；点泊位格也只能选中当下合法的格子。
- **48 小时滞留**：统一由 `isOverstay(berthAt)` / `berthedDurationText()` 计算（`types/berth.ts`），渔港在港船舶列表、泊位格（红框 + 「滞留」角标 + 靠泊时长）、泊位详情弹窗、地图摘要与渔船档案读到的是同一条占用记录。

## 数据存储说明

- **业务数据走 IndexedDB（Dexie）**，库名 `gbfishport-db`，含版本号与升级迁移：
  - `v1`：建 `ports`、`vessels` 表
  - `v2`：新增 `calls` 表与 `vesselId` 索引
  - `v3`：新增 `berths` 表，并按每个渔港登记的泊位数生成初始泊位记录
  - `v4`：`calls` 增 `portId` 索引、`berths` 增 `entryCallId` 索引；迁移时把历史流水回填到对应渔港、把占用泊位绑定到最近一条同船同泊位进港记录并校正靠泊时间
- **表单草稿走 localStorage**（键前缀 `gbfishport:draft:`），例如进出港登记草稿 `gbfishport:draft:call-board`，提交成功后自动清空；泊位状态冲突导致无法提交时草稿不清空。
- 首次打开会自动写入一组演示数据（4 座渔港、6 艘渔船、8 条进出港流水与对应泊位，其中沈家门 B02 靠泊 50 小时用于演示滞留提示），便于直接查看各页面效果。
- 容器无状态：不使用数据库服务、不挂载命名卷，清空浏览器站点数据即可重置。

## 高德地图 Key（可选）

`VITE_AMAP_KEY` 留空时**不会**请求任何外部地图服务，`useAmapLoader()` 立即返回降级标记，页面渲染本地 SVG 网格视图（可点选查看泊位占用）。需要真实底图时，在 `.env` 中填入 key 后重新构建：

```bash
VITE_AMAP_KEY=your-key docker compose up -d --build
```

## 本地开发（可选）

```bash
cd frontend
npm install
npm run dev
```

构建校验（类型检查 + 打包）：`npm run build`（等价于 `vue-tsc -b && vite build`）。
