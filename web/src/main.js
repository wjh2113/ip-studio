/* 先挂上 Pinia 和组件树，再加载 public/js。
 * 那些模块一加载就会按 id 找元素，并且读写 Pinia 里的同一份 state。 */
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { ask } from './lib/feedback.js';

const app = createApp(App);
app.use(createPinia());
app.mount('#cw');
// 还没迁完的 public/js 模块用全局的 ask.confirm（原来由 public/dialog.js 提供）
window.ask = ask;
await import('../../public/app.js');
