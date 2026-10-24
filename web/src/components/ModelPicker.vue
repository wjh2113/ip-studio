<template>
  <div class="mpick" ref="root">
    <!-- 像 Notion AI 的模型菜单：按钮显示当前选的，点开往上弹；最上面是「自动」，下面按厂商分组 -->
    <button type="button" class="mpick-btn" id="chatModelBtn" ref="btn" :class="{ gone: st.modelsGone, open }"
      :disabled="disabled" aria-haspopup="listbox" :aria-expanded="String(open)"
      :title="st.modelsGone ? '你选的模型已停用，点这里重新选' : 'AI 对话用哪个模型（也用于从对话里点的整篇重写），所有稿子共用'"
      @click="toggle" @keydown.down.prevent="openAndFocus(0)" @keydown.up.prevent="openAndFocus(-1)">
      <span class="mpick-btn-label">{{ label }}</span>
      <Icon name="chev-down" :size="12" />
    </button>

    <div v-if="open" class="mpick-menu" id="chatModelMenu" ref="menu" role="listbox" aria-label="选择模型"
      @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)" @keydown.esc.prevent.stop="close(true)"
      @keydown.tab="close(false)">
      <div class="mpick-scroll">
        <button type="button" class="mpick-opt mpick-auto" role="option" data-model="" :aria-selected="String(!st.chatModel)"
          @click="pick('')">
          <span class="mpick-auto-ic"><Icon name="sparkles" :size="15" /></span>
          <span class="mpick-text">
            <span class="mpick-name"><b>自动</b></span>
            <span class="mpick-desc">按功能自动挑档：平衡速度、质量和费用，通道之间可以自动切换。</span>
          </span>
          <Icon v-if="!st.chatModel" class="mpick-check" name="check" :size="15" />
        </button>

        <div v-if="st.modelsGone" class="mpick-gone">
          <Icon name="info" :size="13" />之前选的「{{ st.chatModel }}」已停用，请重新选一个
        </div>
        <div class="mpick-sep"></div>

        <p v-if="!groups.length" class="mpick-empty">{{ st.modelsError ? `模型列表取不到：${st.modelsError}` : '暂时没有可指定的模型，用「自动」就好。' }}</p>
        <section v-for="g in groups" :key="g.vendor" class="mpick-group">
          <h4>{{ g.vendor }}</h4>
          <button v-for="m in g.items" :key="m.id" type="button" class="mpick-opt" role="option" :data-model="m.id"
            :aria-selected="String(st.chatModel === m.id)" :aria-disabled="String(!m.available)" :disabled="!m.available"
            :title="m.available ? m.id : `${m.name} 现在没有可用通道`" @click="pick(m.id)">
            <span class="mpick-dot" :style="{ background: vendorColor(g.vendor) }">{{ g.vendor.slice(0, 1) }}</span>
            <span class="mpick-text">
              <span class="mpick-name"><b>{{ m.main }}</b><span v-if="m.ver" class="mpick-ver">{{ m.ver }}</span>
                <span v-if="m.preview" class="mpick-tag">测试版</span>
                <span v-if="!m.available" class="mpick-tag off">暂不可用</span></span>
            </span>
            <Icon v-if="st.chatModel === m.id" class="mpick-check" name="check" :size="15" />
          </button>
        </section>
      </div>
      <div class="mpick-foot">
        <span>指定了模型就只用它，调不通会直接说，不会偷偷换。</span>
        <button type="button" class="link-btn" id="chatModelRefresh" @click="st.loadModels(true)">刷新</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import Icon from './common/Icon.vue';
import { useSettingsStore } from '../stores/settings.js';
import { groupModels, splitName, vendorColor } from '../lib/models.js';

defineProps({ disabled: { type: Boolean, default: false } });

const st = useSettingsStore();
const open = ref(false);
const root = ref(null);
const btn = ref(null);
const menu = ref(null);

const groups = computed(() => groupModels(st.models));
const label = computed(() => {
  if (st.modelsGone) return '模型已停用';
  if (!st.chatModel) return '自动';
  const m = st.models.find((x) => x.id === st.chatModel);
  if (!m) return st.chatModel;
  const n = splitName(m);
  return [n.main, n.ver].filter(Boolean).join(' ');
});

/* 能用键盘选的项：自动 + 可用的模型 */
const items = () => [...(menu.value?.querySelectorAll('.mpick-opt:not([disabled])') || [])];

function focusSelected(index = null) {
  const list = items();
  if (!list.length) return;
  const sel = list.findIndex((el) => el.getAttribute('aria-selected') === 'true');
  const i = index == null ? Math.max(sel, 0) : (index < 0 ? list.length + index : index);
  list[i]?.focus();
  list[i]?.scrollIntoView({ block: 'nearest' });
}

async function show(index = null) {
  open.value = true;
  void st.loadModels();
  await nextTick();
  focusSelected(index);
  document.addEventListener('mousedown', onOutside, true);
}

function close(refocus = false) {
  open.value = false;
  document.removeEventListener('mousedown', onOutside, true);
  if (refocus) btn.value?.focus();
}

const toggle = () => (open.value ? close() : show());
const openAndFocus = (i) => (open.value ? focusSelected(i) : show(i));

function move(step) {
  const list = items();
  const i = list.indexOf(document.activeElement);
  const next = list[(i + step + list.length) % list.length];
  next?.focus();
  next?.scrollIntoView({ block: 'nearest' });
}

function onOutside(e) {
  if (!root.value?.contains(e.target)) close();
}

async function pick(id) {
  close(true);
  if (id === st.chatModel && !st.modelsGone) return;
  await st.setChatModel(id);
}

onBeforeUnmount(() => document.removeEventListener('mousedown', onOutside, true));
</script>
