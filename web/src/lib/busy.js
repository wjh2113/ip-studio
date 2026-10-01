/* 提交中的状态。同一时刻只允许一个提交在飞行中，防止连点生成重复记录、重复扣点。
 *
 *   const save = useBusy();
 *   <BusyBtn :busy="save.busy.value" @click="save.run(doSave)">保存</BusyBtn>
 *
 * 只锁「会写数据或花点数」的操作。纯读取（翻页、展开）不要包进来，否则正在生成时连列表都点不动。 */
import { ref } from 'vue';

export const lock = ref(false);

export function useBusy() {
  const busy = ref(false);
  async function run(fn) {
    if (lock.value) return undefined;
    lock.value = true;
    busy.value = true;
    try { return await fn(); } finally { lock.value = false; busy.value = false; }
  }
  return { busy, run };
}
