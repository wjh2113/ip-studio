/* 账号（persona）列表和「当前账号」。切换后今天页、任务、口播、回填都跟着这个号走。
 * 当前账号记在本地：下次打开还是它 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '../lib/api.js';

const KEY = 'cw_persona';

export const useAccountStore = defineStore('account', () => {
  const list = ref([]);
  const currentId = ref(uni.getStorageSync(KEY) || null);
  const loaded = ref(false);

  const current = computed(() => list.value.find((p) => p.id === currentId.value) || null);

  async function load() {
    const { personas } = await api('/personas');
    list.value = personas || [];
    loaded.value = true;
    // 记住的账号被删了：落到第一个
    if (!list.value.some((p) => p.id === currentId.value)) select(list.value[0]?.id ?? null);
    return list.value;
  }

  function select(id) {
    currentId.value = id;
    uni.setStorageSync(KEY, id ?? '');
    uni.$emit('persona-changed', id);
  }

  return { list, currentId, current, loaded, load, select };
});
