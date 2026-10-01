<template>
  <fieldset class="subsection">
    <!-- 素材库：作者的真实经历、数据、案例。写作时按题材召回，和栏目素材同属「唯一可信的事实来源」。
       素材越厚，能写的真东西越多，模型编造的余地越小 -->
    <legend>素材库<span>你的真实经历、数据、案例——写作时按题材自动召回</span></legend>

    <div class="mat-add">
      <select id="matKind" v-model="draft.kind">
        <option v-for="k in a.mat.kinds" :key="k">{{ k }}</option>
      </select>
      <input id="matTitle" v-model="draft.title" maxlength="80" placeholder="一句话说清这条是什么，例：第一次带团队把人带走一半">
      <textarea id="matBody" v-model="draft.body" rows="3" maxlength="4000"
        placeholder="具体细节：时间、数字、当时怎么想的、结果如何。越具体，写进稿子时越像真的。"></textarea>
      <div class="mat-add-foot">
        <input id="matTags" v-model="draft.tags" maxlength="200" placeholder="标签，逗号分隔（召回时权重更高）">
        <BusyBtn class="btn primary small" id="matSaveBtn" :busy="saving.busy.value" @click="add">存进素材库</BusyBtn>
      </div>
      <p class="form-error" id="matError">{{ a.mat.error }}</p>
    </div>

    <div class="mat-list" id="matList">
      <template v-for="m in a.mat.list" :key="m.id">
        <div v-if="a.mat.editing === m.id" class="mat-item editing" :data-mat="m.id">
          <div class="mat-head">
            <select v-model="a.mat.edit.kind"><option v-for="k in a.mat.kinds" :key="k">{{ k }}</option></select>
            <input v-model="a.mat.edit.title" maxlength="80">
          </div>
          <textarea v-model="a.mat.edit.body" rows="3" maxlength="4000"></textarea>
          <div class="mat-add-foot">
            <input v-model="a.mat.edit.tags" maxlength="200" placeholder="标签，逗号分隔">
            <button type="button" class="mini" :data-save="m.id" @click="a.saveMaterial(m.id)">保存</button>
            <button type="button" class="mini" data-cancel="1" @click="a.mat.editing = null">取消</button>
          </div>
        </div>
        <div v-else class="mat-item" :data-mat="m.id">
          <div class="mat-head">
            <span class="mat-kind">{{ m.kind }}</span>
            <b>{{ m.title }}</b>
            <span v-if="m.used_count" class="mat-used">用过 {{ m.used_count }} 次</span>
            <span class="mat-acts">
              <button type="button" class="mini" :data-edit="m.id" @click="a.startEditMaterial(m)">改</button>
              <button type="button" class="mini" :data-del="m.id" @click="a.deleteMaterial(m)">删</button>
            </span>
          </div>
          <p>{{ m.body }}</p>
          <div v-if="m.tags" class="mat-tags"><span v-for="(t, i) in tags(m.tags)" :key="i">{{ t }}</span></div>
        </div>
      </template>
    </div>
    <p class="hint" id="matHint">{{ hint }}</p>
  </fieldset>
</template>

<script setup>
import { computed, reactive, watch } from 'vue';
import BusyBtn from './common/BusyBtn.vue';
import { useAccountStore } from '../stores/account.js';
import { useBusy } from '../lib/busy.js';

const a = useAccountStore();
const saving = useBusy();
const draft = reactive({ kind: '', title: '', body: '', tags: '' });

// 种类下拉默认选第一个
watch(() => a.mat.kinds, (kinds) => { if (!draft.kind && kinds.length) draft.kind = kinds[0]; }, { immediate: true });

const tags = (s) => s.split(/[,，]/).map((t) => t.trim()).filter(Boolean);

const hint = computed(() => {
  const list = a.mat.list;
  const used = list.filter((m) => m.used_count).length;
  return list.length
    ? `共 ${list.length} 条，其中 ${used} 条被写进过稿子。写作时按题材自动召回最相关的几条，用不上的不会硬塞。`
    : '还没有素材。存几条真实的经历、数据、案例——这是模型唯一能拿来写"真东西"的来源。';
});

async function add() {
  await saving.run(async () => {
    const ok = await a.addMaterial({ kind: draft.kind, title: draft.title.trim(), body: draft.body.trim(), tags: draft.tags.trim() });
    if (ok) Object.assign(draft, { title: '', body: '', tags: '' });
  });
}
</script>
