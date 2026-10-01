/* 本机偏好：提词器预设、防息屏、各类提醒开关。只存在这台手机上 */
import { reactive, watch } from 'vue';

const KEY = 'cw_prefs';

/* 三个场景预设：室外光强要大字高亮，车上晃要慢滚大字，室内正常 */
export const PRESETS = {
  outdoor: { label: '室外', icon: 'sun', size: 34, speed: 40, bright: 1 },
  car: { label: '车上', icon: 'car', size: 38, speed: 30, bright: 0.85 },
  indoor: { label: '室内', icon: 'building', size: 30, speed: 45, bright: 0.7 },
};

const DEFAULTS = {
  preset: 'indoor',
  keepAwake: true,
  mirror: false,
  cues: true,
  notify: { metrics: true, morning: true, speak: true, jobs: true, quota: true },
};

/* 一个模块级的 reactive 就够了：没有异步、没有派生，用不着 Pinia */
let prefs = null;

export function usePrefs() {
  if (prefs) return prefs;
  let saved = {};
  try { saved = uni.getStorageSync(KEY) || {}; } catch { saved = {}; }
  prefs = reactive({ ...DEFAULTS, ...saved, notify: { ...DEFAULTS.notify, ...(saved.notify || {}) } });
  watch(prefs, () => uni.setStorageSync(KEY, JSON.parse(JSON.stringify(prefs))), { deep: true });
  return prefs;
}
