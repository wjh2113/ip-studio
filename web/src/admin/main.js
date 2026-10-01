/* 管理后台入口（/admin）：独立账号，和业务前台不共享会话 */
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import '../styles/base.css';
import '../styles/shell.css';
import '../styles/admin.css';
import AdminApp from './AdminApp.vue';

createApp(AdminApp).use(createPinia()).mount('#cw');
