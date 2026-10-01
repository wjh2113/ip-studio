/* 先挂上 Pinia 和组件树，再加载 public/js（成稿区那几块还没迁完：它们一加载就会按 id 找元素，
 * 并且把自己的函数登记到 lib/legacy.js），最后启动：拉登录态，决定显示登录页还是进应用。 */
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { ask } from './lib/feedback.js';
import { useSessionStore } from './stores/session.js';

const app = createApp(App);
app.use(createPinia());
app.mount('#cw');
// 还没迁完的 public/js 模块用全局的 ask.confirm（原来由 public/dialog.js 提供）
window.ask = ask;
await import('../../public/app.js');
useSessionStore().boot();
