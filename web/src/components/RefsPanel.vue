<template>
  <fieldset class="subsection" id="refsSection">
    <!-- 成稿参考：这个号生成时带哪些资料。每项能关、能调权重，改了马上存 -->
    <legend>成稿参考<span>这个号生成选题和成稿时带哪些资料；每项能关掉、能调权重，改了马上存，下一篇起生效</span></legend>
    <p v-if="rs.error" class="form-error">{{ rs.error }}</p>
    <p v-else-if="!rs.refs" class="hint">加载中…</p>
    <div v-else class="refs-body">
      <div v-for="x in rs.sources" :key="x.key" class="refs-row" :class="{ off: !rs.refs[x.key]?.on }" :data-ref="x.key">
        <label class="refs-switch">
          <input type="checkbox" :checked="rs.refs[x.key]?.on" @change="rs.set(x.key, { on: $event.target.checked })" />
          <b>{{ x.label }}</b>
        </label>
        <p class="refs-hint">{{ x.hint }}</p>
        <div class="refs-weights" role="radiogroup" :aria-label="`${x.label}的权重`">
          <button v-for="w in rs.weights" :key="w.key" type="button" role="radio" :data-weight="w.key"
            :class="{ on: rs.refs[x.key]?.weight === w.key }" :aria-checked="rs.refs[x.key]?.weight === w.key"
            :disabled="!rs.refs[x.key]?.on" @click="rs.set(x.key, { weight: w.key })">{{ w.label }}</button>
          <span class="refs-count">{{ rs.refs[x.key]?.on ? rs.countText(x, rs.refs[x.key].weight) : '不带' }}</span>
        </div>
      </div>
      <div class="refs-foot">
        <span class="hint">「少量参考」只在很贴切时才用；「重点参考」尽量用上，和别的参考冲突时以它为准。</span>
        <button type="button" class="link-btn" id="refsReset" @click="rs.reset()">恢复默认</button>
      </div>
    </div>
  </fieldset>
</template>

<script setup>
import { watch } from 'vue';
import { useRefsStore } from '../stores/refs.js';

const props = defineProps({ personaId: { type: Number, required: true } });
const rs = useRefsStore();
watch(() => props.personaId, (id) => { if (id) rs.load(id); }, { immediate: true });
</script>
