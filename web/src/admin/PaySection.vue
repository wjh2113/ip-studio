<template>
  <section class="card" data-sec="pay">
    <!-- 私钥只写不读：界面上永远只看得到「已配置 · ****1234」。环境变量里配了的锁住不给改，生产可以完全锁死在环境变量里 -->
    <h2>支付接入<span class="sub">商户私钥能以你的名义收款，所以这里加密存、只写不读</span></h2>
    <p class="hint" :class="{ error: data?.warn }" id="setWarn">{{ data?.warn || '' }}</p>
    <div class="ab-bar">
      <BusyBtn class="btn ghost small" id="setCheck" :busy="checking" @click="check">连通性自检</BusyBtn>
      <span class="grow"></span>
      <span class="hint" id="setChecked">{{ checked ? `当前通道：${checked.provider}${checked.live ? '' : '（演示模式，不会真扣款）'}` : '' }}</span>
    </div>
    <div id="setChecks">
      <div v-for="c in checked?.checks || []" :key="c.name" class="chk-row">
        <span class="dot" :class="{ ok: c.ok }"></span>
        <span class="n">{{ c.name }}</span>
        <span class="d">{{ c.detail }}</span>
        <span class="h">{{ c.hint || '' }}</span>
      </div>
    </div>
    <div id="setFields">
      <p v-if="error" class="hint">{{ error }}</p>
      <div v-for="g in groups" :key="g" class="set-group">
        <h4>{{ g }}</h4>
        <div v-for="f in data.fields.filter((x) => x.group === g)" :key="f.key" class="set-row" :class="{ locked: f.locked }">
          <span class="lab">{{ f.label }}</span>
          <span class="val"><template v-if="f.configured">{{ f.preview }}</template><span v-else style="color:var(--faint)">{{ f.hint || '未配置' }}</span></span>
          <span class="src" :class="f.source === 'env' ? 'env' : f.source ? '' : 'none'">{{ f.source === 'env' ? '环境变量' : f.source ? '后台' : '未配置' }}</span>
          <span v-if="f.locked" class="hint" style="font-size:11px">在服务器上改</span>
          <button v-else class="mini" :data-set="f.key" @click="edit(f)">{{ f.configured ? '更换' : '填写' }}</button>
          <button v-if="f.configured && !f.locked" class="mini" :data-clr="f.key" @click="clear(f)">清空</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, ref } from 'vue';
import BusyBtn from '../components/common/BusyBtn.vue';
import { ask, toast } from '../lib/feedback.js';
import { adminApi } from './store.js';

const data = ref(null);
const error = ref('');
const checked = ref(null);
const checking = ref(false);

const groups = computed(() => [...new Set((data.value?.fields || []).map((f) => f.group))]);

async function load() {
  try { data.value = await adminApi('/admin/settings'); error.value = ''; } catch (err) { error.value = err.message; }
}

async function edit(f) {
  const multiline = /私钥|公钥/.test(f.label);
  const v = await ask.form({
    title: `填写${f.label}`,
    body: multiline ? '粘贴 PEM 全文，包含 BEGIN / END 那两行。' : '',
    ok: '保存',
    fields: [{ key: 'value', label: f.label, required: true, multiline, rows: multiline ? 6 : 1 }],
  });
  if (!v) return;
  try {
    await adminApi('/admin/settings', { method: 'POST', body: { key: f.key, value: v.value } });
    await load();
    toast('已保存');
  } catch (err) { toast(err.message); }
}

async function clear(f) {
  if (!await ask.confirm({ title: '清空这一项？', body: '清空后这个渠道会不可用。', ok: '清空', danger: true })) return;
  try { await adminApi('/admin/settings', { method: 'POST', body: { key: f.key, value: '' } }); await load(); } catch (err) { toast(err.message); }
}

async function check() {
  checking.value = true;
  try { checked.value = await adminApi('/admin/settings/check'); } catch (err) { toast(err.message); } finally { checking.value = false; }
}

load();
</script>
