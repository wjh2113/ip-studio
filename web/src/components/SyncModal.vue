<template>
  <Modal id="syncModal" :open="sync.show" title="同步到 Obsidian" sub="成稿写入知识库；素材库与插件里自选的文件夹双向同步" close-id="syncClose"
    @update:open="(v) => !v && sync.close()">
    <div class="sync-body">
      <ol class="sync-steps">
        <li>
          <b>装插件</b>：下载下面三个文件，放进知识库的 <code>.obsidian/plugins/ip-studio-sync/</code> 文件夹，
          再到 Obsidian「设置 → 第三方插件」里打开「自媒体助手同步」。已装过的请覆盖更新到 0.2.1。
          <div class="sync-files">
            <a v-for="f in FILES" :key="f" class="btn ghost small" :href="`/api/export/plugin/${f}`" :download="f"><Icon name="download" :size="14" />{{ f }}</a>
          </div>
        </li>
        <li>
          <b>填服务器地址</b>：
          <span class="sync-copy"><code id="syncServer">{{ origin }}</code>
            <button type="button" class="mini" @click="copy(origin, '已复制服务器地址')"><Icon name="copy" :size="13" />复制</button></span>
        </li>
        <li>
          <b>填同步密钥</b>：在下面生成一把，复制到插件设置里。密钥可读写素材同步、只读成稿；不能登录、不扣额度，随时可作废。
        </li>
        <li>
          <b>素材文件夹</b>：在插件设置里填写（默认 <code>素材库</code>），只同步该目录下的 <code>.md</code>。两边都改过同一条时会拆成「本机副本」+ 助手版，不互相覆盖。
        </li>
        <li>
          <b>图片</b>：成稿配图与素材里的图都会自动下到「配图文件夹」并嵌入正文；服务器上没有的图会跳过。
        </li>
      </ol>

      <div v-if="sync.justMade" class="sync-new" id="syncNewKey">
        <div class="sync-new-head"><Icon name="key" :size="15" />新密钥「{{ sync.justMade.item.name }}」——<b>只显示这一次</b>，关掉就看不到了</div>
        <div class="sync-copy">
          <code class="sync-key">{{ sync.justMade.key }}</code>
          <button type="button" class="btn primary small" id="syncCopyKey" @click="copy(sync.justMade.key, '已复制密钥，去插件设置里粘贴')"><Icon name="copy" :size="14" />复制</button>
        </div>
      </div>

      <form class="sync-make" @submit.prevent="make">
        <input id="syncKeyName" v-model="name" maxlength="40" placeholder="给这把密钥起个名字，比如「家里的 Windows」" />
        <BusyBtn class="btn primary" id="syncMakeBtn" :busy="busy.busy.value" type="submit"><Icon name="plus" :size="14" />生成同步密钥</BusyBtn>
      </form>

      <div class="sync-list" id="syncKeyList">
        <p v-if="!sync.keys.length" class="hint">{{ sync.loading ? '加载中…' : '还没有同步密钥。' }}</p>
        <div v-for="k in sync.keys" :key="k.id" class="sync-row" :data-key-id="k.id">
          <Icon name="key" :size="15" />
          <div class="grow">
            <b>{{ k.name }}</b>
            <span>{{ k.prefix }}…… · 生成于 {{ stamp(k.created_at) }} · {{ k.last_used_at ? `最后同步 ${stamp(k.last_used_at)}` : '还没用过' }}</span>
          </div>
          <button type="button" class="btn danger small" @click="sync.remove(k)">作废</button>
        </div>
      </div>
    </div>
  </Modal>
</template>

<script setup>
import { ref } from 'vue';
import Modal from './common/Modal.vue';
import BusyBtn from './common/BusyBtn.vue';
import Icon from './common/Icon.vue';
import { useSyncStore } from '../stores/sync.js';
import { useBusy } from '../lib/busy.js';
import { stamp } from '../lib/text.js';
import { toast } from '../lib/feedback.js';

const FILES = ['main.js', 'manifest.json', 'styles.css'];
const sync = useSyncStore();
const busy = useBusy();
const name = ref('');
const origin = globalThis.location?.origin || '';

async function make() {
  await busy.run(() => sync.create(name.value.trim()));
  name.value = '';
}
async function copy(text, msg) {
  try {
    await navigator.clipboard.writeText(text);
    toast(msg);
  } catch {
    toast('复制失败，请手动选中复制');
  }
}
</script>
