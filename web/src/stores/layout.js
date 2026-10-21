/* 版面：创作时左边的账号与创作记录、右边的工具栏都能收起来，给正文腾地方。
 * 收没收起来记在浏览器本地（只是这台电脑上的习惯，读不了就当没收）。
 * 正文阅读宽度也记在本地，默认 760。右栏显示「工具」还是「AI 对话」也记着。 */
import { defineStore } from 'pinia';
import { computed, ref, watch } from 'vue';

const KEY = 'layoutCollapsed';
const WIDTH_KEY = 'contentWidth';

/* 0 = 铺满中间区；其余是像素上限 */
export const CONTENT_WIDTHS = [
  { px: 560, label: '窄 · 560' },
  { px: 680, label: '偏窄 · 680' },
  { px: 760, label: '默认 · 760' },
  { px: 900, label: '宽 · 900' },
  { px: 1080, label: '更宽 · 1080' },
  { px: 0, label: '铺满' },
];

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}

function readWidth() {
  try {
    const raw = localStorage.getItem(WIDTH_KEY);
    if (raw == null || raw === '') return 760;
    const n = Number(raw);
    if (CONTENT_WIDTHS.some((w) => w.px === n)) return n;
  } catch { /* 隐私模式 */ }
  return 760;
}

export const useLayoutStore = defineStore('layout', () => {
  const saved = read();
  const side = ref(Boolean(saved.side));     // 左侧：账号设定、创作记录
  const work = ref(Boolean(saved.work));     // 右侧：版本对照、检查、多平台、配图、口播
  const pane = ref(saved.pane === 'chat' ? 'chat' : 'tools');   // 右栏：工具面板 / AI 对话
  const contentWidth = ref(readWidth());

  watch([side, work, pane], ([s, w, p]) => {
    try { localStorage.setItem(KEY, JSON.stringify({ side: s, work: w, pane: p })); } catch { /* 隐私模式 */ }
  });
  watch(contentWidth, (n) => {
    try { localStorage.setItem(WIDTH_KEY, String(n)); } catch { /* 隐私模式 */ }
  });

  // 手机上侧栏的页签：创作记录 / 账号（只在窄屏用，不记）
  const mtab = ref('history');

  const contentWidthCss = computed(() => (contentWidth.value > 0 ? `${contentWidth.value}px` : 'none'));
  const contentWidthLabel = computed(() => (
    CONTENT_WIDTHS.find((w) => w.px === contentWidth.value)?.label
    || (contentWidth.value > 0 ? `${contentWidth.value}` : '铺满')
  ));

  function setContentWidth(px) {
    const n = Number(px);
    if (!CONTENT_WIDTHS.some((w) => w.px === n)) return;
    contentWidth.value = n;
  }

  const toggleSide = () => { side.value = !side.value; };
  const toggleWork = () => { work.value = !work.value; };
  return {
    side, work, pane, mtab, toggleSide, toggleWork,
    contentWidth, contentWidthCss, contentWidthLabel, setContentWidth,
  };
});
