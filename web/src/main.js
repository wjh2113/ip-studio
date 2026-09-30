/* Vue 3 只负责把和原来一样的页面树挂上。
 * 功能模块在 public/js，里面一加载就会按 id 找元素、绑事件，
 * 所以必须等挂载完成再加载，否则 el 全是空的。 */
import { createApp } from 'vue';
import App from './App.vue';

createApp(App).mount('#cw');
await import('../../public/app.js');
