/* 挂上 Pinia 和组件树，然后启动：拉登录态，决定显示登录页还是进应用。 */
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import './styles/app.css';
import App from './App.vue';
import { useSessionStore } from './stores/session.js';

const app = createApp(App);
app.use(createPinia());
app.mount('#cw');
useSessionStore().boot();
