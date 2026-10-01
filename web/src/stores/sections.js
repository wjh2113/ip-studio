/* 内容栏目：账号下的几条内容线，创作时选一条。
 * 栏目列表放在 studio.sections / studio.presets（简报和管理浮层共用），这里管加载和管理浮层的开关。 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../lib/api.js';
import { toast } from '../lib/feedback.js';
import { useStudioStore } from './studio.js';

export const useSectionsStore = defineStore('sections', () => {
  const managerOpen = ref(false);
  const personaId = ref(null);      // 管理浮层正在管哪个账号的栏目

  async function load(pid) {
    const s = useStudioStore();
    if (!pid) { s.sections = []; return false; }
    try {
      const { sections, presets } = await api(`/personas/${pid}/sections`);
      s.sections = sections;
      s.presets = presets;
      return true;
    } catch { return false; }        // 账号不在了就静默
  }

  async function openManager() {
    const persona = useStudioStore().currentPersona;
    if (!persona) { toast('先选一个账号'); return; }
    personaId.value = persona.id;
    managerOpen.value = true;
    await load(persona.id);
  }

  /* 关掉管理浮层。简报那一排读的是同一份 studio.sections，增删过会自己跟上 */
  function closed() {
    managerOpen.value = false;
  }

  return { managerOpen, personaId, load, openManager, closed };
});
