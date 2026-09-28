import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import 'element-plus/dist/index.css';
import './styles/main.css';
import App from './App.vue';
import router from './router';
import { ensureSeedData } from './db/seed';
import { startPortRealtimeSync } from './stores/portStore';
import { startVesselRealtimeSync } from './stores/vesselStore';

async function bootstrap(): Promise<void> {
  // 先写入演示数据（IndexedDB），失败不阻塞应用启动；再订阅数据变更
  try {
    await ensureSeedData();
  } catch (error) {
    console.warn('[gbfishport] 初始化本地数据失败：', error);
  }

  const app = createApp(App);
  app.use(createPinia());
  app.use(router);
  app.use(ElementPlus, { locale: zhCn });

  // 全表实时同步：其他标签页的进出港登记会立刻反映到本页泊位状态
  startPortRealtimeSync();
  startVesselRealtimeSync();

  app.mount('#app');
}

void bootstrap();
