<template>
  <div class="persona-bar lib-side" id="libKinds">
    <!-- 素材库页的侧栏上半截：按种类筛，代替账号设定（素材不挂账号）。「选题灵感」切到选题池 -->
    <div class="sidebar-head">
      <span class="sh-title">素材分类<Icon name="gear" :size="14" /></span>
      <button type="button" class="icon-btn small" title="新建素材" @click="lib.startCreate()"><Icon name="plus" :size="16" /></button>
    </div>
    <nav class="lib-kind-list" aria-label="素材分类">
      <button type="button" class="kind-nav" :class="{ on: lib.tab === 'materials' && !lib.kind }" data-kind-nav=""
        @click="pick('')">
        <span class="kind-ico" data-kind="all"><Icon name="folder" :size="15" /></span>
        <span class="grow">全部</span>
        <i>{{ counts[''] || 0 }}</i>
      </button>
      <button v-for="k in lib.kinds" :key="k" type="button" class="kind-nav" :data-kind-nav="k"
        :class="{ on: lib.tab === 'materials' && lib.kind === k }" @click="pick(k)">
        <span class="kind-ico" :data-kind="k"><Icon :name="kindIcon(k)" :size="15" /></span>
        <span class="grow">{{ k }}</span>
        <i>{{ counts[k] || 0 }}</i>
      </button>
      <button type="button" class="kind-nav" :class="{ on: lib.tab === 'pool' }" data-kind-nav="pool" @click="lib.tab = 'pool'">
        <span class="kind-ico" data-kind="pool"><Icon name="bulb" :size="15" /></span>
        <span class="grow">选题灵感</span>
        <i>{{ openPool }}</i>
      </button>
    </nav>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import Icon from './common/Icon.vue';
import { kindIcon, useLibraryStore } from '../stores/library.js';

const lib = useLibraryStore();
const counts = computed(() => lib.countsByKind());
const openPool = computed(() => lib.pool.filter((x) => x.status !== 'done').length);

function pick(k) {
  lib.tab = 'materials';
  lib.kind = k;
}
</script>
