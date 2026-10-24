<template>
<div class="account-page" id="settingsPage" :class="{ hidden: !st.open }">
  <div class="acc-form">
    <header class="acc-head">
      <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>自媒体助手</span></div>
      <button class="acc-back" type="button" id="settingsCloseBtn" title="返回" @click="st.close()"><Icon name="arrow-left" :size="15" />返回</button>
      <h2>个人设置 · {{ s.user?.username }}</h2>
      <span class="grow"></span>
    </header>
    <div class="acc-body">
      <nav class="acc-nav">
        <p class="acc-nav-note pp-note">
          <Icon name="info" :size="14" />
          <span>这里的设置跟着你的账号，所有创作号共用。</span>
        </p>
      </nav>
      <div class="acc-main settings-main">
        <p v-if="st.loading" class="hint">加载中…</p>
        <template v-else>
          <fieldset class="subsection" id="settingsLlm">
            <legend>模型能力<span>写稿、改稿、对话时用哪一档模型</span></legend>
            <div class="settings-opts" role="radiogroup" aria-label="模型能力">
              <label v-for="o in LLM_PREF_OPTIONS" :key="o.key" class="settings-opt" :class="{ on: st.llmPref === o.key }">
                <input type="radio" name="llmPref" :value="o.key" :checked="st.llmPref === o.key"
                  :disabled="st.saving" @change="st.save({ llmPref: o.key })" />
                <span>
                  <b>{{ o.label }}</b>
                  <small>{{ o.hint }}</small>
                </span>
              </label>
            </div>
          </fieldset>

          <fieldset class="subsection" id="settingsChatModel">
            <legend>AI 对话用的模型<span>成稿右栏「AI 对话」和从对话里点的整篇重写用它；对话框左下角也能直接切</span></legend>
            <template v-if="st.canPick">
              <label class="settings-keep">
                <span class="field-label">模型</span>
                <select id="settingsModelSel" :value="st.modelsGone ? '__gone__' : st.chatModel" @change="st.setChatModel($event.target.value)">
                  <option value="">自动（推荐）</option>
                  <option v-for="m in st.models" :key="m.id" :value="m.id" :disabled="!m.available">{{ m.name }}{{ m.available ? '' : '（暂不可用）' }}</option>
                  <option v-if="st.modelsGone" value="__gone__" disabled>已停用：{{ st.chatModel }}</option>
                </select>
              </label>
              <p v-if="st.modelsGone" class="form-error">你选的模型已停用，请重新选择。</p>
              <p class="hint">「自动」按上面的模型能力选档，网关可以在通道之间切换；指定了模型就只用那一个，调不通会直接告诉你，不会偷偷换成别的。写稿、检查等其他功能仍按上面的模型能力走。</p>
            </template>
            <p v-else class="hint">当前接入方式只支持自动选模型。</p>
            <p v-if="st.modelsError" class="form-error">模型列表取不到：{{ st.modelsError }}</p>
          </fieldset>

          <fieldset class="subsection" id="settingsChatKeep">
            <legend>对话记录保存<span>右栏 AI 对话超过这个天数会自动删；对你所有稿子都生效</span></legend>
            <label class="settings-keep">
              <span class="field-label">保存天数</span>
              <select id="settingsKeepSel" :value="st.chatKeepDays" :disabled="st.saving"
                @change="st.save({ chatKeepDays: Number($event.target.value) })">
                <option v-for="k in KEEP_OPTIONS" :key="k.days" :value="k.days">{{ k.label }}</option>
              </select>
            </label>
            <p class="hint">默认 100 天。清空某一篇的对话仍在成稿右栏「AI 对话」里操作，正文不受影响。</p>
          </fieldset>

          <p v-if="st.error" class="form-error">{{ st.error }}</p>
        </template>
      </div>
    </div>
  </div>
</div>
</template>

<script setup>
import Icon from './common/Icon.vue';
import { KEEP_OPTIONS, LLM_PREF_OPTIONS, useSettingsStore } from '../stores/settings.js';
import { useStudioStore } from '../stores/studio.js';
import { escStack } from '../lib/escape.js';
import { watch } from 'vue';

const st = useSettingsStore();
const s = useStudioStore();

const esc = escStack(() => st.open, () => st.close());
watch(() => st.open, (open) => {
  esc.toggle(open);
  document.body.classList.toggle('no-scroll', open);
}, { immediate: true });
</script>
