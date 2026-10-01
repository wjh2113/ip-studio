/* 落地页入口 */
import { createApp } from 'vue';
import '../styles/base.css';
import '../styles/create.css';
import '../styles/landing.css';
import LandingApp from './LandingApp.vue';

createApp(LandingApp).mount('#cw');
