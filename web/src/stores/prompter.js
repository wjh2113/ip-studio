/* 提词器：把口播提示切好的段落全屏滚动播出来，可以边看边录。
 * 滚动、按键、录音这些跟画面紧贴的东西在 Prompter.vue 里；这里只管开关和记住的设置。 */
import { defineStore } from 'pinia';
import { reactive, ref } from 'vue';
import { toast } from '../lib/feedback.js';
import { useStudioStore } from './studio.js';

const DEFAULTS = { speed: 40, size: 40, cues: true, mirror: false };
const KEY = 'cw.prompter';

export const usePrompterStore = defineStore('prompter', () => {
  const show = ref(false);
  const cfg = reactive({ ...DEFAULTS });

  function loadCfg() {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (saved) Object.assign(cfg, DEFAULTS, saved);
    } catch { /* 用默认值 */ }
  }

  function saveCfg() {
    try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* 隐私模式存不了就算了 */ }
  }

  function open() {
    if (!useStudioStore().draft?.cues?.cues?.length) { toast('先生成口播提示'); return; }
    loadCfg();
    show.value = true;
  }

  return { show, cfg, open, saveCfg };
});
