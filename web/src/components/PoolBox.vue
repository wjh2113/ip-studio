<template>
  <div class="card pool" id="poolBox">
    <!-- 选题池：热点里看到的、推荐里想留的，不当场写也不丢。刻意不做完整日历：自媒体的排期粒度就是「这周写哪几条」 -->
    <div class="side-head">
      <h3>选题池<em id="poolNote">{{ note }}</em></h3>
      <button class="btn ghost small" type="button" id="poolToggle" @click="b.pool.open = !b.pool.open"><Icon :name="b.pool.open ? 'chev-up' : 'chev-down'" :size="14" />{{ b.pool.open ? '收起' : '展开' }}</button>
    </div>
    <div v-if="b.pool.open" class="pool-list" id="poolList">
      <div v-if="b.pool.list.length" class="pool-th"><span>来源</span><span>题材</span><span>排期日期</span><span>操作</span></div>
      <div v-for="x in b.pool.list" :key="x.id" class="pool-row" :class="{ today: overdue(x), done: x.status === 'done' }" :data-pool="x.id">
        <span class="src" :data-src="x.source">{{ x.source }}</span>
        <span class="subj" :title="x.note || x.subject">{{ x.subject }}</span>
        <input type="date" :value="x.plan_date" :data-date="x.id" title="排到哪天，留空就只是待选" @change="b.datePool(x.id, $event.target.value)">
        <span class="pool-acts">
          <button type="button" class="mini" :data-write="x.id" @click="b.writePool(x)">写这条</button>
          <button type="button" class="mini rm" :data-poolrm="x.id" title="删" @click="remove(x)"><Icon name="trash" :size="14" /></button>
        </span>
      </div>
      <div v-if="!b.pool.list.length" class="pool-empty"><Icon name="inbox" :size="28" /><b>还没有选题记录</b>热点板块里看到能蹭的、推荐题材里想留的，都可以先存进来。</div>
      <div class="pool-add">
        <span class="pool-add-label">想到什么先记一条</span>
        <div class="pool-add-row">
          <input id="poolInput" v-model="input" placeholder="快速记录你的灵感或选题，回车存入" @keydown.enter.prevent="add">
          <button class="btn primary small" type="button" id="poolAddBtn" @click="add">存入选题池</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import Icon from './common/Icon.vue';
import { useBriefStore } from '../stores/brief.js';
import { ask } from '../lib/feedback.js';
import { localDay } from '../lib/text.js';

const b = useBriefStore();
const input = ref('');

const overdue = (x) => Boolean(x.plan_date && x.plan_date <= localDay() && x.status !== 'done');

const note = computed(() => {
  const list = b.pool.list;
  if (!list.length) return '空的';
  const undone = list.filter((x) => x.status !== 'done');
  const due = undone.filter((x) => x.plan_date && x.plan_date <= localDay()).length;
  return `${undone.length} 条待写${due ? ` · ${due} 条到期` : ''}`;
});

async function add() {
  if (await b.addPool(input.value)) input.value = '';
}

async function remove(x) {
  if (!await ask.confirm({
    title: x.subject ? `删掉选题「${x.subject}」？` : '删掉这条选题？',
    body: '选题池里去掉。已经写成的稿子还在。',
    ok: '删除', danger: true,
  })) return;
  b.removePool(x.id);
}
</script>
