/* 创作简报（第一步）的表单状态。放 store 里：从选题池、灵感、今天页跳进来时能预先填好题材 */
import { defineStore } from 'pinia';
import { reactive, ref } from 'vue';

export const useCreateStore = defineStore('create', () => {
  const form = reactive({ subject: '', platform: '', tone: '', audience: '', keywords: '', length: 600 });
  const sectionId = ref(null);
  const frameworkKey = ref(null);
  const hotspot = ref(null);
  const inputs = reactive({});
  const poolId = ref(null);          // 从选题池拿的题材：成稿后把那条标成已用

  function prefill({ subject = '', hot = null, pool = null } = {}) {
    form.subject = subject;
    hotspot.value = hot;
    poolId.value = pool;
  }

  function reset() {
    form.subject = '';
    form.keywords = '';
    sectionId.value = null;
    frameworkKey.value = null;
    hotspot.value = null;
    poolId.value = null;
    for (const k of Object.keys(inputs)) delete inputs[k];
  }

  return { form, sectionId, frameworkKey, hotspot, inputs, poolId, prefill, reset };
});
