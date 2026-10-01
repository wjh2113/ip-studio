<template>
<div id="authScreen" class="auth-screen" :class="{ hidden: !session.showAuth }">
  <div class="auth-card">
    <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>自媒体助手</span></div>
    <p class="auth-sub" id="authSub">{{ auth.gate ? '输入访问密码进入。与 API 网关管理台同一组密码。' : '给一个题材，先出三个话题方向，选中后生成完整成稿。' }}</p>

    <div v-if="!auth.gate" class="tabs" id="authTabs">
      <button class="tab" :class="{ active: mode === 'login' }" data-mode="login" @click="setMode('login')">登录</button>
      <button v-if="canRegister" class="tab" :class="{ active: mode === 'register' }" data-mode="register" id="registerTab"
        @click="setMode('register')">注册</button>
    </div>

    <form id="authForm" autocomplete="on" @submit.prevent="submit">
      <label v-if="!auth.gate" id="userRow">用户名<input name="username" v-model="username" required maxlength="24" placeholder="2-24 位，支持中英文" autocomplete="username" /></label>
      <label>密码<input name="password" v-model="password" type="password" required minlength="6"
        :placeholder="auth.gate ? '访问密码' : '至少 6 位'" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" /></label>
      <label v-if="mode === 'register' && auth.invite" id="inviteRow">邀请码<input name="invite" v-model="invite" maxlength="40" placeholder="需要邀请码才能注册" autocomplete="off" /></label>
      <p class="form-error" id="authError">{{ error }}</p>
      <BusyBtn type="submit" class="btn primary block" id="authSubmit" :busy="busy">{{ auth.gate ? '进入' : mode === 'login' ? '登录' : '注册并进入' }}</BusyBtn>
    </form>
    <p class="auth-tip" id="authTip">{{ auth.gate || !canRegister ? '不开放公开注册。' : '每个账号的创作记录相互独立。' }}</p>
  </div>
</div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import BusyBtn from './common/BusyBtn.vue';
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

function setMode(m) {
  mode.value = m;
  error.value = '';
}

// 从落地页带 ?signup=1 过来的，直接停在注册页；不开放注册就把这个参数去掉
watch(() => s.meta, (meta) => {
  if (!meta || !new URLSearchParams(location.search).get('signup')) return;
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
