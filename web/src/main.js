/* 先挂上 Pinia 和组件树，再加载 public/js。
 * 那些模块一加载就会按 id 找元素，并且读写 Pinia 里的同一份 state。 */
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';

const app = createApp(App);
app.use(createPinia());
app.mount('#cw');
await import('../../public/app.js');
