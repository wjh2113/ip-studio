<template>
  <Modal id="titleModal" v-model:open="t.show" title="标题候选" :sub="t.limit ? `这个平台标题不超过 ${t.limit} 字` : ''"
    close-id="titleClose" sub-id="titleSub">
    <div class="title-list" id="titleList">
      <template v-if="t.loading"><div v-for="i in 3" :key="i" class="idea-skeleton"></div></template>
      <p v-else-if="t.error" class="form-error">{{ t.error }}</p>
      <template v-else>
      <div v-for="(x, i) in t.titles" :key="i" class="title-row">
        <div class="title-main">
          <b>{{ x.text }}</b>
          <div class="title-meta">
            <span v-if="x.type" class="fw-tag">{{ x.type }}</span>
            <span :class="x.over ? 'form-error' : 'hint'">{{ x.chars }} 字{{ x.over ? '，超过平台上限' : '' }}</span>
            <span v-if="x.risk?.length" class="form-error">含「{{ x.risk.join('、') }}」，注意广告法</span>
          </div>
          <p v-if="x.why" class="hint">{{ x.why }}</p>
        </div>
        <button type="button" class="btn ghost small" :data-title="i" :disabled="t.applying !== null" @click="t.apply(i)">用这个</button>
      </div>
      </template>
    </div>
    <div class="section-form-foot">
      <button class="btn ghost small" type="button" id="titleAgain" :disabled="t.loading" @click="t.load()">换一批</button>
    </div>
  </Modal>
</template>

<script setup>
import Modal from './common/Modal.vue';
import { useTitlesStore } from '../stores/titles.js';

const t = useTitlesStore();
</script>
