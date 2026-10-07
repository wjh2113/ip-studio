<template>
<div class="account-page" id="personaModal" :class="{ hidden: !page.open }">
  <form id="personaForm" @submit.prevent="a.save()" @input="unmark">
    <header class="acc-head">
      <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>自媒体助手</span></div>
      <button class="acc-back" type="button" id="personaCloseBtn" title="返回" @click="a.close()"><Icon name="arrow-left" :size="15" />返回</button>
      <h2 id="personaModalTitle">{{ title }}</h2>
      <span class="grow"></span>
      <span class="acc-hint" id="personaSaveHint" :class="{ on: page.hint, ok: /^已/.test(page.hint || '') }">{{ page.hint }}</span>
      <button v-if="page.id" class="btn danger" type="button" id="personaDeleteBtn" @click="a.remove()"><Icon name="trash" :size="14" />删除账号</button>
      <button class="btn ghost" type="button" id="personaCancelBtn" @click="a.close()">取消</button>
      <BusyBtn type="submit" class="btn primary" id="personaSaveBtn" :busy="page.saving">保存</BusyBtn>
    </header>

    <div class="acc-body">
      <nav class="acc-nav" id="accountNav">
        <button v-for="(t, i) in ACCOUNT_TABS" :key="t.key" type="button" :data-tab="t.key" :class="{ on: page.tab === t.key }"
          :disabled="t.needsSaved && !page.id" :title="t.needsSaved && !page.id ? '先保存账号再设置这一项' : t.hint"
          @click="showTab(t.key)">
          <span class="acc-no">{{ i + 1 }}</span>
          <span class="acc-nav-txt"><b><Icon :name="TAB_ICON[t.key]" :size="15" />{{ t.label }}<em v-if="t.needsSaved && !page.id" class="acc-lock"><Icon name="lock" :size="11" />先保存账号</em></b><i>{{ t.hint }}</i></span>
        </button>
        <p v-if="!page.id" class="acc-nav-note"><Icon name="info" :size="14" />未保存账号时，语气样本不能用。先保存账号，再继续完善。</p>
        <p class="acc-nav-note acc-nav-elsewhere" id="accountElsewhere"><Icon name="info" :size="14" /><span>你的经历和数据在右上角<button type="button" class="link-btn" id="accountToProfile" @click="toProfile">个人档案</button>里，所有账号共用；文章、链接、图片这些外部资料在顶部的「素材库」。</span></p>
      </nav>

      <div class="acc-main" ref="main">
        <p class="form-error" id="personaError">{{ page.error }}</p>

        <section class="acc-panel" data-panel="basic" v-show="page.tab === 'basic'">
          <div class="acc-card">
          <div class="acc-card-head">
            <span class="acc-card-ic"><Icon name="doc" :size="18" /></span>
            <div><h3>基本信息</h3><p>这个号是谁、写给谁、解决什么问题——每次创作都会带上</p></div>
            <span class="grow"></span>
            <p v-if="!page.id" class="quick-tip" id="quickTip"><Icon name="wand" :size="15" /><a href="#" id="quickLink" @click.prevent="a.quick.open = true">贴一段自我介绍，帮你填好</a></p>
          </div>
          <div class="acc-grid">
          <label class="full">账号名称 <span class="req">*</span>
            <input name="name" v-model="f.name" required maxlength="40" placeholder="例：下班后的厨房" :class="filled('name')" ref="nameBox" />
          </label>

          <div class="grid">
            <label>发布平台<select name="platform" id="personaPlatform" v-model="f.platform" :class="filled('platform')">
              <option v-for="p in s.meta?.platforms || []" :key="p.key" :value="p.key">{{ p.label }}</option>
            </select></label>
            <label>风格调性<select name="tone" id="personaTone" v-model="f.tone" :class="filled('tone')">
              <option v-for="t in s.meta?.tones || []" :key="t.key" :value="t.key" :title="t.hint">{{ t.key }}</option>
            </select></label>
          </div>

          <label class="full">主要内容
            <textarea name="content_focus" v-model="f.content_focus" rows="2" maxlength="500" :class="filled('content_focus')"
              placeholder="这个号主要写什么。例：工作日 30 分钟内能做完的家常菜，侧重备菜和一锅出"></textarea>
          </label>

          <label class="full">目标用户
            <textarea name="audience" v-model="f.audience" rows="2" maxlength="500" :class="filled('audience')"
              placeholder="给谁看。例：25-35 岁独居或两人住的上班族，会做饭但没时间"></textarea>
          </label>

          <label class="full">解决的问题
            <textarea name="problem" v-model="f.problem" rows="2" maxlength="500" :class="filled('problem')"
              placeholder="读者的痛点。例：下班太累不想做饭，又不想天天点外卖"></textarea>
          </label>

          <label class="full">备注 / 禁忌
            <textarea name="notes" v-model="f.notes" rows="2" maxlength="800" :class="filled('notes')"
              placeholder="固定要求或不能写的东西。例：不推广付费课程；每篇结尾带一句用量提醒"></textarea>
          </label>
          </div>
          </div>
        </section>

        <section class="acc-panel" data-panel="persona" v-show="page.tab === 'persona'">
          <fieldset class="subsection">
            <legend>个人人设<span>选填 · 决定第一人称用谁的口吻、拿什么举例</span></legend>

            <div class="grid">
              <label>年龄<input name="creator_age" v-model="f.creator_age" maxlength="20" placeholder="例：32，或 30 岁出头" :class="filled('creator_age')" /></label>
              <label>性别
                <select name="creator_gender" v-model="f.creator_gender" :class="filled('creator_gender')">
                  <option value="">不设定</option>
                  <option value="男">男</option>
                  <option value="女">女</option>
                  <option value="其他">其他</option>
                </select>
              </label>
              <label>所在行业<input name="creator_industry" v-model="f.creator_industry" maxlength="60" placeholder="例：互联网" :class="filled('creator_industry')" /></label>
              <label>岗位<input name="creator_role" v-model="f.creator_role" maxlength="60" placeholder="例：产品经理" :class="filled('creator_role')" /></label>
            </div>

            <label class="full">性格特征
              <textarea name="creator_traits" v-model="f.creator_traits" rows="2" maxlength="300" :class="filled('creator_traits')"
                placeholder="例：说话直接不绕弯，爱吐槽，怕麻烦所以什么都想找省事的做法"></textarea>
            </label>
          </fieldset>
        </section>

        <section class="acc-panel" data-panel="style" v-show="page.tab === 'style'">
          <fieldset v-if="page.id" class="subsection" id="styleSection">
            <legend>语气样本<span>喂你自己写的文章，学你真实的语感——越多越准，最多 {{ a.style.max }} 篇</span></legend>

            <div class="imp-box" id="importBox">
              <div class="pf-parse-head"><Icon name="download" :size="15" /><b>导入以前写的文章</b><span class="hint">选 Word、PDF、.md 或 .txt（一次最多 20 篇），或者粘贴一篇；导入后在后台逐篇学习</span></div>
              <div class="pf-row">
                <label class="btn ghost small imp-file"><Icon name="doc" :size="13" />选文件<input id="importFiles" type="file" accept=".docx,.pdf,.md,.markdown,.txt" multiple class="sr-only" @change="L.pickFiles($event.target.files); $event.target.value = ''" /></label>
                <span v-if="L.imp.reading" class="hint">正在读文件…</span>
                <span v-else-if="L.imp.files.length" class="hint" id="importPicked">已选 {{ L.imp.files.length }} 篇：{{ L.imp.files.map((x) => x.title).join('、').slice(0, 60) }}</span>
                <button v-if="L.imp.files.length || L.imp.failed.length" type="button" class="link-btn" id="importClear" @click="L.imp.files = []; L.imp.failed = []">清空</button>
              </div>
              <ul v-if="L.imp.failed.length || L.imp.files.some((x) => x.warnings?.length)" class="imp-issues" id="importIssues">
                <li v-for="x in L.imp.failed" :key="'f' + x.file" class="form-error">{{ x.file }}：{{ x.reason }}</li>
                <li v-for="x in L.imp.files.filter((y) => y.warnings?.length)" :key="'w' + x.file" class="hint">{{ x.file }}：{{ x.warnings[0] }}</li>
              </ul>
              <input id="importPasteTitle" v-model="L.imp.pasteTitle" maxlength="120" placeholder="粘贴的这篇的标题（选填）" @keydown.enter.prevent />
              <textarea id="importPaste" v-model="L.imp.paste" rows="4" placeholder="或者把一篇文章粘贴在这里（至少 100 字）"></textarea>
              <div class="pf-row">
                <BusyBtn class="btn primary small" id="importBtn" :busy="L.imp.running" @click="doImport">导入并学习</BusyBtn>
                <span v-if="L.imp.result?.skipped?.length" class="hint">没导入：{{ L.imp.result.skipped.map((x) => `${x.title || '未命名'}（${x.reason}）`).join('、') }}</span>
              </div>
            </div>

            <div class="sample-list" id="sampleList">
              <div v-for="x in a.style.samples" :key="x.id" class="sample-row" :data-sample-row="x.id">
                <span class="sample-src" :data-src="x.source">{{ SRC[x.source] || '手动' }}</span>
                <span class="name">{{ x.title || '未命名样本' }}</span>
                <span v-if="x.weight > 1" class="meta" title="发布后自动加入，改得越多权重越高">权重 {{ x.weight.toFixed(1) }}</span>
                <span class="meta">{{ x.learned ? '已学' : '待学' }} · {{ x.length }} 字</span>
                <button type="button" class="del" :data-sample="x.id" title="删除" @click="a.deleteSample(x.id)">×</button>
              </div>
            </div>
            <div class="digest-box" id="digestBox"><template v-if="a.style.digest"><b>学到的语气档案</b>{{ a.style.digest }}</template></div>
            <div class="sample-actions">
              <BusyBtn v-if="a.style.samples.length" class="btn ghost small" id="rebuildDigestBtn" :busy="rebuild.busy.value"
                @click="rebuild.run(a.rebuildDigest)">从头梳理</BusyBtn>
              <span class="hint" id="styleHint">{{ a.style.error || (a.style.samples.length ? `已学 ${a.style.samples.length} 篇；改稿习惯和学习记录在「AI 眼中的我」` : '导入以前的文章，或在成稿页点「喂给账号学习」') }}</span>
            </div>
          </fieldset>
        </section>

        <section class="acc-panel" data-panel="me" v-show="page.tab === 'me'">
          <MePanel v-if="page.id && seen.me" />
        </section>
      </div>
    </div>
  </form>
</div>
</template>

<script setup>
/* 账号设定页：整屏盖在应用上，左边四个板块，右边是当前板块的表单。数据和保存逻辑在 stores/account.js */
import { computed, nextTick, reactive, ref, watch } from 'vue';
import BusyBtn from './common/BusyBtn.vue';
import Icon from './common/Icon.vue';
import MePanel from './MePanel.vue';
import { useLearningStore } from '../stores/learning.js';
import { ACCOUNT_TABS, useAccountStore } from '../stores/account.js';
import { useStudioStore } from '../stores/studio.js';
import { useBusy } from '../lib/busy.js';
import { escStack } from '../lib/escape.js';

const a = useAccountStore();
const s = useStudioStore();
const page = a.page;
const f = page.form;
const main = ref(null);
const nameBox = ref(null);
const rebuild = useBusy();
const L = useLearningStore();
const TAB_ICON = { basic: 'doc', persona: 'user', style: 'mic', me: 'eye' };
const SRC = { manual: '手动', published: '发布', import: '导入', quickstart: '建号' };
/* AI 眼中的我第一次点开才挂载（会去拉数据） */
const seen = reactive({ me: false });
watch(() => page.tab, (t) => { if (t in seen) seen[t] = true; }, { immediate: true });

// 后台学习任务做完：样本列表的「待学 / 已学」跟着变
watch(() => L.learnedAt, () => { if (page.open && page.id) a.loadSamples(page.id); });

async function doImport() {
  const out = await L.runImport(page.id);
  if (out) a.loadSamples(page.id);
}

const title = computed(() => {
  const p = a.editingPersona;
  return p ? `账号设定 · ${p.name}` : (page.id ? '账号设定' : '新建账号设定');
});

/* 快速建号帮忙填的字段高亮一下，改过就去掉：高亮只是告诉他「这是帮你填的，看一眼」 */
const filled = (k) => (page.quickFilled.has(k) ? 'quick-filled' : '');
function unmark(e) {
  const k = e.target?.name;
  if (k && page.quickFilled.has(k)) page.quickFilled.delete(k);
}

/* 经历、数据在个人档案：关掉账号设定，打开个人档案 */
function toProfile() {
  a.close();
  L.openProfile();
}

function showTab(key) {
  page.tab = key;
  main.value?.scrollTo({ top: 0 });
}

const esc = escStack(() => page.open, () => a.close());
watch(() => page.open, (open) => {
  esc.toggle(open);
  document.body.classList.toggle('no-scroll', open);
  if (open) nextTick(() => nameBox.value?.focus());
}, { immediate: true });
</script>
