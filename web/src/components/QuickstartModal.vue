<template>
  <Modal id="quickModal" v-model:open="q.open" title="贴一段自我介绍" sub="先帮你把账号设定填出来，你再改" close-id="quickClose">
    <!-- 快速建号：新手面对十几个设定项最容易放弃。先贴一段自我介绍（可以再贴几篇旧文章），
       模型把账号设定填好放进表单，他检查、改完再保存——把「填写」变成「检查」 -->
    <label class="full">自我介绍
      <textarea id="quickIntro" v-model="q.intro" rows="6" maxlength="3000" ref="introBox"
        placeholder="例：我做了 8 年产品经理，二胎妈妈。在小红书写职场妈妈怎么安排时间，读者大多是 30 岁上下、刚回职场的女性。不想写鸡汤，想写能照着做的。"></textarea>
    </label>
    <label class="full">以前写过的文章（选填）
      <textarea id="quickPosts" v-model="q.posts" rows="6"
        placeholder="贴 1～5 篇，篇与篇之间单独一行写 ---&#10;会存成语气样本，之后的成稿更像你自己写的"></textarea>
    </label>
    <p class="hint">只填介绍里看得出来的，看不出来的留空，不替你编年龄和经历。结果先放进账号设定给你改，改好再保存。</p>
    <p class="form-error" id="quickError">{{ q.error }}</p>
    <div class="modal-foot">
      <span class="grow"></span>
      <button type="button" class="btn ghost" @click="q.open = false">取消</button>
      <BusyBtn class="btn primary" id="quickRun" :busy="q.running" @click="a.runQuick()">帮我填好</BusyBtn>
    </div>
  </Modal>
</template>

<script setup>
import { nextTick, ref, watch } from 'vue';
import Modal from './common/Modal.vue';
import BusyBtn from './common/BusyBtn.vue';
import { useAccountStore } from '../stores/account.js';

const a = useAccountStore();
const q = a.quick;
const introBox = ref(null);

watch(() => q.open, (open) => {
  if (!open) return;
  q.error = '';
  nextTick(() => introBox.value?.focus());
});
</script>
