/* 管理后台入口（/admin）：独立账号，和业务前台不共享会话 */
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import '../styles/app.css';
import AdminApp from './AdminApp.vue';

createApp(AdminApp).use(createPinia()).mount('#cw');
