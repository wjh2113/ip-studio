/* App 入口：uni-app 要求导出 createApp，状态用 Pinia（和网页端同一套写法） */
import { createSSRApp } from 'vue';
import * as Pinia from 'pinia';
import App from './App.vue';

export function createApp() {
  const app = createSSRApp(App);
  app.use(Pinia.createPinia());
  return { app, Pinia };
}
