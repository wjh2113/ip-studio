<template>
  <div class="mat-form" id="matForm" @keydown.esc="lib.cancelForm()">
    <!-- 新增 / 编辑素材（整页）：左边录内容，右边定属性和去处，底部固定操作条 -->
    <div class="mat-form-head">
      <button type="button" class="icon-btn" title="返回素材库" @click="lib.cancelForm()"><Icon name="arrow-left" :size="18" /></button>
      <h2>{{ f.id ? '编辑素材' : '新增素材' }}</h2>
    </div>

    <div class="mat-form-grid">
      <!-- 左：内容录入 -->
      <section class="mat-form-card mat-form-input">
        <div class="mat-modes" role="tablist" aria-label="录入方式">
          <button v-for="m in MODES" :key="m.key" type="button" role="tab" class="mat-mode" :data-mode="m.key"
            :class="{ on: f.mode === m.key }" :aria-selected="f.mode === m.key" @click="lib.setMode(m.key)">
            <Icon :name="m.icon" :size="15" />{{ m.label }}
          </button>
          <button type="button" class="mat-mode" data-mode="clip" @click="lib.importClipboard()">
            <Icon name="clipboard" :size="15" />剪贴板导入
          </button>
        </div>

        <div class="mat-form-pane">
          <!-- 图片 -->
          <div v-if="f.mode === 'image' && !f.id" class="mat-drop" :class="{ has: !!f.image, over: dragOver }"
            @dragover.prevent="dragOver = true" @dragleave="dragOver = false" @drop.prevent="onDrop">
            <template v-if="f.image">
              <img :src="f.image" alt="" />
              <div class="mat-drop-meta">
                <b>{{ f.imageName }}</b>
                <button type="button" class="btn ghost small" @click="imageInput?.click()">换一张</button>
                <button type="button" class="btn ghost small" @click="f.image = ''; f.imageName = ''">移除</button>
              </div>
            </template>
            <button v-else type="button" class="mat-drop-empty" @click="imageInput?.click()">
              <Icon name="image" :size="28" />
              <b>点这里选图，或把图片拖进来</b>
              <span>JPG / PNG，3MB 以内</span>
            </button>
            <input ref="imageInput" type="file" accept="image/jpeg,image/png" class="sr-only" @change="onImage" />
          </div>
          <p v-if="f.mode === 'image' && f.id" class="hint">已存的图片不能在这里替换；要换图请新建一条。</p>

          <!-- 语音 -->
          <div v-if="f.mode === 'voice'" class="mat-voice">
            <button type="button" class="mat-rec" :class="{ on: f.recording, busy: f.transcribing }" id="matRecBtn"
              :disabled="f.transcribing" @click="lib.toggleRecord()">
              <Icon :name="f.recording ? 'pause' : 'mic'" :size="22" />
            </button>
            <div>
              <b>{{ f.recording ? '正在录…再点一下结束' : f.transcribing ? '正在转成文字…' : '点一下开始说' }}</b>
              <span>说完自动转成文字，接在下面的内容后面，可以再改</span>
            </div>
          </div>

          <!-- 链接 / 视频：链接放在最前面 -->
          <div v-if="f.mode === 'link' || f.mode === 'video'" class="mat-field">
            <div class="mat-label">{{ f.mode === 'video' ? '视频链接' : '文章链接' }}<em>*</em></div>
            <div class="mat-url">
              <input v-model="urlDraft" type="url" :placeholder="f.mode === 'video' ? '抖音、B 站、视频号等视频的分享链接' : '请输入文章链接（支持主流平台）'"
                @keydown.enter.prevent="extract" />
              <button type="button" class="btn primary" :disabled="f.extracting" @click="extract">{{ f.extracting ? '提取中…' : '提取预览' }}</button>
            </div>
          </div>

          <div class="mat-field grow">
            <div class="mat-label">{{ contentLabel }}<em v-if="f.target === 'material' && !f.image">*</em></div>
            <div class="mat-area" :class="{ tall: expanded }">
              <textarea id="matBody" v-model="f.body" :maxlength="BODY_MAX" :placeholder="placeholder"></textarea>
              <div class="mat-area-foot">
                <span>{{ f.body.length }}/{{ BODY_MAX }}</span>
                <button type="button" class="lib-act" :title="expanded ? '收起' : '展开'" @click="expanded = !expanded"><Icon name="expand" :size="14" /></button>
              </div>
            </div>
          </div>

          <!-- 文本 / 语音 / 图片：链接预览是可选的 -->
          <div v-if="f.mode !== 'link' && f.mode !== 'video'" class="mat-field">
            <div class="mat-label">链接预览<span class="opt">（可选）</span></div>
            <div class="mat-url">
              <input v-model="urlDraft" type="url" placeholder="请输入文章链接（支持主流平台）" @keydown.enter.prevent="extract" />
              <button type="button" class="btn primary" :disabled="f.extracting" @click="extract">{{ f.extracting ? '提取中…' : '提取预览' }}</button>
            </div>
          </div>

          <div v-if="f.preview" class="mat-preview" id="matPreview">
            <span class="lib-thumb big" data-kind="链接"><Icon :name="f.mode === 'video' ? 'video' : 'link'" :size="24" /></span>
            <div>
              <b>{{ f.preview.title }}</b>
              <p>{{ f.preview.excerpt }}</p>
              <a :href="f.preview.url" target="_blank" rel="noopener noreferrer"><Icon name="link" :size="12" />{{ f.preview.url }}</a>
            </div>
            <button type="button" class="icon-btn" title="去掉预览" @click="lib.clearPreview(); urlDraft = ''"><Icon name="x" :size="16" /></button>
          </div>
        </div>
      </section>

      <!-- 右：素材属性 -->
      <aside class="mat-form-card mat-form-attrs">
        <h3>素材属性</h3>

        <div class="mat-field">
          <div class="mat-label">素材种类<em>*</em></div>
          <div class="mat-kinds">
            <button v-for="k in kindChoices" :key="k" type="button" class="mat-kind-pick" :data-pick="k"
              :class="{ on: isKindOn(k) }" :disabled="!!f.id && k === POOL_KIND" @click="lib.setKind(k)">{{ k }}</button>
          </div>
        </div>

        <div class="mat-field">
          <div class="mat-label">{{ f.target === 'pool' ? '题材' : '标题' }}<em v-if="f.target === 'pool' || !autoTitle">*</em></div>
          <div class="mat-count-input">
            <input id="matTitle" v-model="f.title" :maxlength="TITLE_MAX"
              :placeholder="f.target === 'pool' ? '一句话说清想写什么' : '请输入素材标题（不填就用内容第一句）'" />
            <span>{{ f.title.length }}/{{ TITLE_MAX }}</span>
          </div>
        </div>

        <div v-if="f.target === 'material'" class="mat-field">
          <div class="mat-label">标签</div>
          <div class="mat-count-input">
            <input id="matTags" v-model="f.tags" maxlength="200" placeholder="请输入标签，多个标签用逗号分隔" />
            <span :class="{ over: tagCount > TAG_MAX }">{{ tagCount }}/{{ TAG_MAX }}</span>
          </div>
          <div class="mat-presets">
            <span>内容性质</span>
            <button v-for="t in lib.CONTENT_TAGS" :key="t" type="button" class="tag-chip" :class="{ on: lib.formHasTag(t) }"
              @click="lib.toggleFormTag(t)">{{ t }}</button>
          </div>
        </div>

        <div class="mat-field">
          <div class="mat-label">目标<em>*</em></div>
          <div class="mat-radios">
            <label><input type="radio" name="matTarget" value="material" :checked="f.target === 'material'" @change="lib.setTarget('material')" />存入素材库</label>
            <label><input type="radio" name="matTarget" value="pool" :checked="f.target === 'pool'" :disabled="!!f.id" @change="lib.setTarget('pool')" />选题池</label>
          </div>
        </div>

        <div class="mat-field">
          <div class="mat-label">关联当前账号</div>
          <template v-if="f.target === 'pool'">
            <label class="mat-persona">
              <span class="persona-avatar" :data-tone="tone(persona?.name)">
                <Icon v-if="!persona" name="layers" :size="15" /><template v-else>{{ persona.name[0] }}</template>
              </span>
              <span class="mat-persona-text">
                <b>{{ persona?.name || '不关联账号' }}<em v-if="persona" class="pf-tag">{{ s.platformLabel(persona.platform) }}</em></b>
                <small>{{ persona?.content_focus || '所有账号都能看到这条选题' }}</small>
              </span>
              <Icon name="chev-down" :size="16" />
              <select id="matPersona" v-model="f.personaId" aria-label="关联账号">
                <option :value="null">不关联账号</option>
                <option v-for="p in s.personas" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
            </label>
          </template>
          <p v-else class="mat-persona-note"><Icon name="info" :size="14" />素材归你本人，所有账号写作时都能按题材召回，不用挑账号。</p>
        </div>

        <p v-if="lib.error" class="form-error" id="matError">{{ lib.error }}</p>
      </aside>
    </div>

    <!-- 底部操作条 -->
    <div class="mat-form-bar">
      <span class="mat-draft">
        <template v-if="!f.id && lib.draftSaved"><Icon name="check-circle" :size="14" />草稿已存在本机，关掉页面也不会丢</template>
        <template v-else-if="f.target === 'pool'"><Icon name="bulb" :size="14" />存进选题池，在「选题灵感」里排期、开写</template>
        <template v-else><Icon name="info" :size="14" />素材仅作参考，写作时按题材召回，不会编造</template>
      </span>
      <BusyBtn class="btn primary" id="matSave" :busy="saving.busy.value" @click="save(false)">保存</BusyBtn>
      <BusyBtn v-if="!f.id" class="btn outline" id="matSaveAgain" :busy="savingAgain.busy.value" @click="save(true)">保存并继续新建</BusyBtn>
      <button type="button" class="btn danger" id="matCancel" @click="lib.cancelForm()">取消</button>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import Icon from './common/Icon.vue';
import BusyBtn from './common/BusyBtn.vue';
import { useStudioStore } from '../stores/studio.js';
import { POOL_KIND, TAG_MAX, TITLE_MAX, tagList, useLibraryStore } from '../stores/library.js';
import { useBusy } from '../lib/busy.js';

const BODY_MAX = 15000;
const MODES = [
  { key: 'text', label: '文本', icon: 'doc' },
  { key: 'link', label: '链接', icon: 'link' },
  { key: 'image', label: '图片', icon: 'image' },
  { key: 'video', label: '视频', icon: 'play' },
  { key: 'voice', label: '语音', icon: 'mic' },
];

const s = useStudioStore();
const lib = useLibraryStore();
const f = lib.form;
const saving = useBusy();
const savingAgain = useBusy();
const imageInput = ref(null);
const urlDraft = ref(f.sourceUrl || '');
const dragOver = ref(false);
const expanded = ref(false);

watch(() => f.sourceUrl, (v) => { if (v && v !== urlDraft.value) urlDraft.value = v; });
watch(() => f.open, () => { urlDraft.value = f.sourceUrl || ''; });

const kindChoices = computed(() => {
  const ks = [...lib.kinds];
  // 设计稿顺序：选题灵感排在对标账号前面
  const i = ks.indexOf('对标账号');
  ks.splice(i >= 0 ? i : ks.length, 0, POOL_KIND);
  return ks;
});
const isKindOn = (k) => (f.target === 'pool' ? k === POOL_KIND : f.kind === k);
const persona = computed(() => s.personas.find((p) => p.id === f.personaId) || null);
const tagCount = computed(() => tagList(f.tags).length);
const autoTitle = computed(() => !!f.body.trim());
const contentLabel = computed(() => ({
  image: '图片说明', voice: '转写内容', link: '正文', video: '视频说明',
})[f.mode] || (f.target === 'pool' ? '备注' : '内容录入'));
const placeholder = computed(() => ({
  text: '请输入或粘贴文章内容，支持多种格式…',
  link: '提取后正文会自动填进来；提取不到时直接把正文贴进来',
  image: '这张图说的是什么：地点、数据、要点',
  video: '视频讲了什么、哪几段可以引用',
  voice: '录完的文字会出现在这里，也可以直接打字',
})[f.mode]);

const tone = (name = '') => [...name].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 5;

onMounted(() => { document.getElementById(f.mode === 'link' || f.mode === 'video' ? 'matForm' : 'matBody')?.focus?.(); });

function extract() { lib.extractPreview(urlDraft.value); }
function onImage(e) {
  lib.pickImage(e.target.files?.[0]);
  e.target.value = '';
}
function onDrop(e) {
  dragOver.value = false;
  lib.pickImage(e.dataTransfer?.files?.[0]);
}
async function save(again) {
  // 链接框里填了但没点「提取」：也当来源存上
  if (urlDraft.value.trim() && !f.sourceUrl && /^https?:\/\//i.test(urlDraft.value.trim())) f.sourceUrl = urlDraft.value.trim();
  await (again ? savingAgain : saving).run(() => lib.saveForm({ again }));
  if (again) urlDraft.value = '';
}
</script>
