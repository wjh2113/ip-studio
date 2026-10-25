<template>
<div class="account-page skill-lib" id="skillLib" :class="{ hidden: !sk.lib.open }">
  <div class="acc-form">
    <header class="acc-head">
      <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>自媒体助手</span></div>
      <button class="acc-back" type="button" id="skillLibBack" title="返回" @click="sk.lib.open = false"><Icon name="arrow-left" :size="15" />返回</button>
      <h2>技能库</h2>
      <span class="skill-muted skill-count">{{ sk.list.length }} / {{ sk.max }}</span>
      <span class="grow"></span>
      <button type="button" class="btn primary small" id="skillLibNew" @click="sk.openPage(null)"><Icon name="plus" :size="13" />新建技能</button>
    </header>
    <div class="skill-scroll">
      <div class="skill-lib-col">
        <div class="skill-lib-bar">
          <input id="skillLibSearch" v-model="q" placeholder="搜索技能名字、描述、标签…" />
          <div class="skill-lib-tags">
            <button type="button" :class="{ on: !tag }" @click="tag = ''">全部</button>
            <button v-for="t in sk.allTags" :key="t" type="button" :data-tag="t" :class="{ on: tag === t }" @click="tag = tag === t ? '' : t">{{ t }}</button>
          </div>
        </div>

        <div v-if="!sk.list.length" class="skill-lib-empty">
          <p>还没有技能。把常用的改稿要求做成技能，划词菜单和 AI 对话里一点就能用。从一个模板开始：</p>
          <div class="skill-templates">
            <button v-for="t in SKILL_TEMPLATES" :key="t.key" type="button" class="skill-tpl" :data-tpl="t.key" @click="sk.openPage(null, t)">{{ t.name }}</button>
          </div>
        </div>
        <p v-else-if="!shown.length" class="hint">没有匹配的技能。</p>

        <div class="skill-grid" id="skillGrid">
          <article v-for="x in shown" :key="x.id" class="skill-card" :data-skill="x.id" tabindex="0" @click="sk.openPage(x.id)" @keydown.enter="sk.openPage(x.id)">
            <h3><Icon name="file" :size="15" />{{ x.name }}</h3>
            <p class="skill-card-desc">{{ x.description || '没写描述' }}</p>
            <div class="skill-card-tags"><span v-for="t in x.tags" :key="t" class="mpick-tag">{{ t }}</span></div>
            <p class="skill-card-meta">正文 {{ x.size }} 字<template v-if="x.refCount"> · 参考资料 {{ x.refCount }} 条</template><template v-if="x.inReview"> · <span class="skill-review-on" title="成稿检查会对照这个技能">检查时参考</span></template> · {{ fmt(x.updated_at) }}</p>
            <div class="skill-card-acts">
              <button type="button" class="link-btn" data-act="copy" @click.stop="sk.copy(x.id)">复制</button>
              <button type="button" class="link-btn danger" data-act="del" @click.stop="sk.remove(x)">删除</button>
            </div>
          </article>
        </div>
      </div>
    </div>
  </div>
</div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import Icon from './common/Icon.vue';
import { SKILL_TEMPLATES, useSkillsStore } from '../stores/skills.js';
import { escStack } from '../lib/escape.js';

const sk = useSkillsStore();
const q = ref('');
const tag = ref('');
const shown = computed(() => sk.search(q.value).filter((x) => !tag.value || (x.tags || []).includes(tag.value)));
const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '');

const esc = escStack(() => sk.lib.open && !sk.page.open, () => { sk.lib.open = false; });
watch(() => sk.lib.open, (open) => {
  esc.toggle(open);
  document.body.classList.toggle('no-scroll', open || sk.page.open);
  if (open) { q.value = ''; tag.value = ''; void sk.load(true); }
}, { immediate: true });
</script>
