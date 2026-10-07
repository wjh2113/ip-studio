<template>
  <Modal id="insightsModal" v-model:open="m.insightsOpen" title="复盘" size="wide" close-id="insightsClose"
    sub-id="insightsNote" :sub="r ? `已回填 ${r.total} 篇` : ''" :mask-close="false" body-id="insightsBody">
    <p v-if="m.reportError" class="hint error">{{ m.reportError }}</p>
    <template v-else-if="!r"><div class="idea-skeleton"></div><div class="idea-skeleton"></div></template>
    <template v-else>
      <p class="hint ins-note">{{ r.note }}</p>
      <section v-for="g in groups" :key="g.title" class="ins-block">
        <h3>{{ g.title }}<em>{{ g.hint }}</em></h3>
        <table v-if="g.rows.length" class="admin-table">
          <thead><tr><th>{{ g.title }}</th><th class="num">篇数</th>
            <th class="num">阅读中位数</th><th class="num" title="只比发布后第 5～9 天记下的数">第 7 天阅读</th><th class="num">点赞中位数</th></tr></thead>
          <tbody>
            <tr v-for="row in g.rows" :key="row.name">
              <td>{{ row.name }}</td>
              <td class="num">{{ row.count }}</td>
              <td class="num"><template v-if="row.views != null">{{ row.views }}</template><span v-else class="dim">样本不足</span></td>
              <td class="num"><template v-if="row.views7 != null">{{ row.views7 }}</template><span v-else class="dim">—</span></td>
              <td class="num"><template v-if="row.likes != null">{{ row.likes }}</template><span v-else class="dim">—</span></td>
            </tr>
          </tbody>
        </table>
        <p v-else class="hint">还没有可分组的数据。</p>
      </section>
      <section class="ins-block"><h3>明细<em>最近 40 篇</em></h3>
        <table class="admin-table"><thead><tr>
          <th>标题</th><th>平台</th><th>发布</th><th class="num">阅读</th><th class="num">点赞</th><th>走势</th><th>备注</th>
        </tr></thead><tbody>
          <tr v-for="(x, i) in r.items" :key="i">
            <td>{{ x.title }}</td>
            <td>{{ s.platformLabel(x.platform) }}</td>
            <td class="mono">{{ x.published_at || '' }}</td>
            <td class="num">{{ x.metrics.views ?? '—' }}</td>
            <td class="num">{{ x.metrics.likes ?? '—' }}</td>
            <td class="ins-trend">{{ trendText(x.trend) }}</td>
            <td>{{ x.metrics.note || '' }}</td>
          </tr>
        </tbody></table>
      </section>
    </template>
  </Modal>
</template>

<script setup>
import { computed } from 'vue';
import Modal from './common/Modal.vue';
import { useInsightsStore } from '../stores/insights.js';
import { useStudioStore } from '../stores/studio.js';

const m = useInsightsStore();
const s = useStudioStore();
const r = computed(() => m.report);

const groups = computed(() => (r.value ? [
  { title: '平台', rows: r.value.byPlatform, hint: '同一篇发不同平台，表现差很多' },
  { title: '栏目', rows: r.value.bySection, hint: '哪个栏目的读者最买账' },
  { title: '方向类型', rows: r.value.byLabel, hint: '反常识 / 方法拆解 / 个人经历…哪类更吃香' },
  { title: '标题写法', rows: r.value.byTitle || [], hint: '提问式 / 数字清单 / 反差对比…按标题自动归类' },
  { title: '开头方式', rows: r.value.byOpening || [], hint: '场景故事 / 抛出问题 / 数据事实…按正文第一段自动归类' },
] : []));

/* 走势：「第 1 天 1200 → 第 7 天 5400」，只回填过一次就不显示 */
function trendText(trend = []) {
  const pts = (trend || []).filter((t) => t.views != null);
  if (pts.length < 2) return '';
  return pts.map((t) => `${t.day != null ? `第 ${t.day} 天` : t.on} ${t.views}`).join(' → ');
}
</script>
