/* 热点板块：抓全网榜单 → 和当前账号的定位逐条比对 → 给出可蹭的点和选题。
 * 进板块时只把上次的结果和缓存的榜单摆出来，不自动烧一次模型调用；要比对得自己点。 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api } from '../lib/api.js';
import { useStudioStore } from './studio.js';

export const useHotStore = defineStore('hot', () => {
  const result = ref(null);        // 这个号最近一次比对：{ at, total, matches, screened, sources, note }
  const boards = ref(null);        // 抓到的原始榜单：{ at, items, sources }
  const boardsLoading = ref(false);
  const boardsError = ref('');
  const running = ref('');         // '' | 'auto' | 'manual'
  const runError = ref('');

  async function open() {
    const s = useStudioStore();
    result.value = null;
    runError.value = '';
    const persona = s.currentPersona;
    if (!persona) return;
    try {
      const { hotspots } = await api(`/personas/${persona.id}/hotspots`);
      if (useStudioStore().personaId === persona.id) result.value = hotspots;
    } catch { /* 读缓存失败就当没有 */ }
    if (!boards.value) loadBoards();
  }

  async function loadBoards(force = false) {
    boardsLoading.value = true;
    boardsError.value = '';
    try {
      boards.value = await api(`/hotspots${force ? '?force=1' : ''}`);
    } catch (err) {
      boardsError.value = err.message;
    } finally {
      boardsLoading.value = false;
    }
  }

  /* 比对。body.manual 是手动粘的榜单，不传就抓全网 */
  async function run(body = {}) {
    const persona = useStudioStore().currentPersona;
    if (!persona || running.value) return;
    running.value = body.manual ? 'manual' : 'auto';
    runError.value = '';
    result.value = null;
    try {
      const { hotspots } = await api(`/personas/${persona.id}/hotspots`, { method: 'POST', body });
      result.value = hotspots;
      if (!body.manual) loadBoards();
    } catch (err) {
      runError.value = err.message;
    } finally {
      running.value = '';
    }
  }

  return { result, boards, boardsLoading, boardsError, running, runError, open, loadBoards, run };
});
