/* A/B 和 Eval 共用的「功能」列表（从 /admin/variants 拿到）。两块各选各的功能 */
import { ref } from 'vue';

const features = ref([]);

export function useAdminFeatures() {
  return { features, feature: ref('') };
}
