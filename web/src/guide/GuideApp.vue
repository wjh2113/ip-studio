<template>
  <header class="docs-head">
    <div class="docs-head-in">
      <span class="brand-mark" aria-hidden="true"></span>
      <div>
        <h1>{{ title }}</h1>
        <p class="sub">自媒体助手 · 新人操作手册</p>
      </div>
      <div class="docs-head-acts">
        <a class="btn ghost small" href="/app">回到产品</a>
      </div>
    </div>
  </header>

  <div class="docs-body guide-body">
    <nav v-if="toc.length" class="docs-nav" id="guideNav">
      <div class="grp"><b>目录</b>
        <a v-for="t in toc" :key="t.id" :href="`#${t.id}`" :class="{ on: spy === t.id }">{{ t.text }}</a>
      </div>
    </nav>
    <main class="docs-main">
      <p v-if="error" class="pd" id="guideError">{{ error }}</p>
      <article v-else class="guide-md" id="guideBody" v-html="html"></article>
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { markdown } from '../lib/text.js';

const title = ref('使用说明');
const markdownText = ref('');
const error = ref('');
const spy = ref('');
const html = computed(() => withHeadingIds(markdown(markdownText.value)));

const toc = computed(() => {
  const out = [];
  for (const m of html.value.matchAll(/<h([23])\s+id="([^"]+)">(.*?)<\/h\1>/g)) {
    out.push({ level: Number(m[1]), id: m[2], text: m[3].replace(/<[^>]+>/g, '') });
  }
  return out;
});

function withHeadingIds(src) {
  let n = 0;
  return src.replace(/<h([23])>(.*?)<\/h\1>/g, (_, level, inner) => {
    n += 1;
    return `<h${level} id="g-${n}">${inner}</h${level}>`;
  });
}

async function load() {
  try {
    const res = await fetch('/api/guide', { credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      error.value = '请先登录后再看使用说明。';
      setTimeout(() => { location.href = '/app'; }, 1200);
      return;
    }
    if (!res.ok) throw new Error(data.error || '加载失败');
    title.value = data.title || '使用说明';
    markdownText.value = data.markdown || '';
  } catch (err) {
    error.value = err.message || '加载失败';
  }
}

function onScroll() {
  const heads = [...document.querySelectorAll('#guideBody h2[id], #guideBody h3[id]')];
  let cur = '';
  for (const h of heads) {
    if (h.getBoundingClientRect().top <= 100) cur = h.id;
  }
  spy.value = cur;
}

onMounted(async () => {
  await load();
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
});
onUnmounted(() => window.removeEventListener('scroll', onScroll));
</script>
