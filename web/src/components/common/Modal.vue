<template>
  <div class="modal-mask" :id="id" :class="{ hidden: !open }" @click.self="maskClose && close()">
    <!-- 用 hidden 类而不是 v-if：关上再打开时里面的输入不丢，浏览器测试也按 .hidden 判断开关 -->
    <div class="modal" :class="size">
      <div class="modal-head">
        <h2>{{ title }}<span v-if="sub || $slots.sub" class="modal-sub" :id="subId"><slot name="sub">{{ sub }}</slot></span></h2>
        <button type="button" class="icon-btn" :id="closeId" title="关闭" @click="close">×</button>
      </div>
      <div class="modal-body" :id="bodyId"><slot /></div>
    </div>
  </div>
</template>

<script setup>
/* 通用浮层：遮罩 + 标题行（标题、小字说明、×）+ 内容。
 * 开关用 v-model:open。Esc 只关最上面那一层（几个浮层可能叠着开，比如设定页里再开栏目管理）。 */
import { onBeforeUnmount, watch } from 'vue';
import { escStack } from '../../lib/escape.js';

const props = defineProps({
  id: { type: String, default: undefined },
  open: { type: Boolean, default: false },
  title: { type: String, default: '' },
  sub: { type: String, default: '' },
  size: { type: String, default: '' },          // '' | 'wide' | 'fw-modal'
  maskClose: { type: Boolean, default: true },  // 点遮罩关；有要填的东西、误触代价大的传 false
  closeId: { type: String, default: undefined },
  subId: { type: String, default: undefined },
  bodyId: { type: String, default: undefined },
});
const emit = defineEmits(['update:open', 'close']);

function close() {
  emit('update:open', false);
  emit('close');
}

const off = escStack(() => props.open, close);
watch(() => props.open, (v) => off.toggle(v), { immediate: true });
onBeforeUnmount(() => off.toggle(false));
</script>
