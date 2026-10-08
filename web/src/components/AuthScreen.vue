<template>
<div id="authScreen" class="auth-screen" :class="{ hidden: !session.showAuth }">
  <!-- 品牌是登录页的主视觉：大号标志 + 名字，副文案一句话说清楚这个产品干什么 -->
  <div class="auth-hero">
    <div class="auth-brand"><span class="brand-mark" aria-hidden="true"></span><span>自媒体助手</span></div>
    <p class="auth-sub" id="authSub">{{ auth.gate ? '输入访问密码进入。与 API 网关管理台同一组密码。' : '给一个题材，先出三个话题方向，选中后生成完整成稿。' }}</p>
  </div>
  <div class="auth-card" :class="{ gate: auth.gate }">
    <div v-if="auth.gate" class="gate-mark" aria-hidden="true"><Icon name="lock" :size="26" /></div>
    <div v-if="!auth.gate" class="tabs" id="authTabs">
      <button class="tab" :class="{ active: mode === 'login' }" data-mode="login" @click="setMode('login')">登录</button>
      <button v-if="canRegister" class="tab" :class="{ active: mode === 'register' }" data-mode="register" id="registerTab"
        @click="setMode('register')">注册</button>
    </div>

    <form id="authForm" autocomplete="on" @submit.prevent="submit">
      <label v-if="!auth.gate" id="userRow">用户名<span class="input-ic"><Icon name="user" /><input name="username" v-model="username" required maxlength="24" placeholder="2-24 位，支持中英文" autocomplete="username" /></span></label>
      <label>{{ auth.gate ? '访问密码' : '密码' }}<span class="input-ic"><Icon name="lock" /><input name="password" v-model="password" :type="peek ? 'text' : 'password'" required minlength="6"
        :placeholder="auth.gate ? '访问密码' : '至少 6 位'" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" />
        <button type="button" class="peek" :class="{ on: peek }" :title="peek ? '隐藏密码' : '显示密码'" @click="peek = !peek"><Icon name="eye" /></button></span></label>
      <label v-if="mode === 'register' && auth.invite" id="inviteRow">邀请码<span class="input-ic"><Icon name="key" /><input name="invite" v-model="invite" maxlength="40" placeholder="管理员发给你的邀请码" autocomplete="off" /></span></label>
      <p class="form-error" id="authError">{{ error }}</p>
      <BusyBtn type="submit" class="btn primary block lg" id="authSubmit" :busy="busy">{{ auth.gate ? '进入' : mode === 'login' ? '登录' : '注册并进入' }}</BusyBtn>
    </form>
    <p class="auth-tip" id="authTip"><Icon :name="auth.gate || !canRegister ? 'lock' : 'info'" :size="14" />{{ auth.gate || !canRegister ? '不开放公开注册。' : '每个账号的创作记录相互独立。' }}</p>
  </div>
</div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import BusyBtn from './common/BusyBtn.vue';
import Icon from './common/Icon.vue';
import { useSessionStore } from '../stores/session.js';
import { useStudioStore } from '../stores/studio.js';

const session = useSessionStore();
const s = useStudioStore();
const auth = computed(() => s.meta?.auth || {});
const canRegister = computed(() => !auth.value.gate && auth.value.register !== false);

const mode = ref('login');
const username = ref('');
const password = ref('');
const invite = ref('');
const error = ref('');
const busy = ref(false);
const peek = ref(false);

function setMode(m) {
  mode.value = m;
  error.value = '';
}

// 从落地页带 ?signup=1 过来的，直接停在注册页；不开放注册就把这个参数去掉。
// 邀请链接还带着 &invite=码：码先填好
watch(() => s.meta, (meta) => {
  const q = new URLSearchParams(location.search);
  if (!meta || !q.get('signup')) return;
  if (q.get('invite')) invite.value = q.get('invite');
  if (canRegister.value) mode.value = 'register';
  else history.replaceState(null, '', '/');
}, { immediate: true });

async function submit() {
  if (busy.value) return;
  error.value = '';
  busy.value = true;
  try {
    // 访问门禁模式只有一个密码：走登录接口，用户名留空
    const m = auth.value.gate ? 'login' : mode.value;
    await session.login(m, {
      username: auth.value.gate ? '' : username.value,
      password: password.value,
      ...(m === 'register' ? { invite: invite.value } : {}),
    });
    username.value = '';
    password.value = '';
    invite.value = '';
  } catch (err) {
    error.value = err.message;
  } finally {
    busy.value = false;
  }
}
</script>
