/* 版面：创作时左边的账号与创作记录、右边的工具栏都能收起来，给正文腾地方。
 * 收没收起来记在浏览器本地（只是这台电脑上的习惯，读不了就当没收）。 */
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

const KEY = 'layoutCollapsed';

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}

export const useLayoutStore = defineStore('layout', () => {
  const saved = read();
  const side = ref(Boolean(saved.side));     // 左侧：账号设定、创作记录
  const work = ref(Boolean(saved.work));     // 右侧：版本对照、检查、多平台、配图、口播

  watch([side, work], ([s, w]) => {
    try { localStorage.setItem(KEY, JSON.stringify({ side: s, work: w })); } catch { /* 隐私模式 */ }
  });

  // 手机上侧栏的页签：创作记录 / 账号（只在窄屏用，不记）
  const mtab = ref('history');

  const toggleSide = () => { side.value = !side.value; };
  const toggleWork = () => { work.value = !work.value; };
  return { side, work, mtab, toggleSide, toggleWork };
});
