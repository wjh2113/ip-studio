<template>
  <Modal id="inviteModal" :open="inv.show" title="邀请码" sub="生成一个码发给对方，凭码注册，一码一人；各人只看得到自己的内容" close-id="inviteClose"
    @update:open="(v) => !v && (inv.show = false)">
    <div class="sync-body">
      <!-- 服务器不是「凭码注册」时，码发出去也用不上：说清楚要改哪一项 -->
      <p v-if="inv.mode === 'open'" class="invite-warn" id="inviteModeWarn">现在注册是公开的，谁都能注册，不需要邀请码。要改成凭码注册，在服务器 .env 里设 <code>REGISTER_OPEN=0</code> 后重启。</p>
      <p v-else-if="inv.mode === 'closed'" class="invite-warn" id="inviteModeWarn">现在开着访问密码（<code>ACCESS_PASSWORD</code>），所有人共用一个账号，注册是关的，邀请码用不上。去掉它、设 <code>REGISTER_OPEN=0</code> 后重启。</p>

      <form class="sync-make" @submit.prevent="make">
        <input id="inviteNote" v-model="note" maxlength="60" placeholder="备注：发给谁，比如「小王」" />
        <select id="inviteCount" v-model.number="count" title="一次生成几个">
          <option v-for="n in [1, 3, 5, 10]" :key="n" :value="n">{{ n }} 个</option>
        </select>
        <BusyBtn class="btn primary" id="inviteMakeBtn" :busy="busy.busy.value" type="submit"><Icon name="plus" :size="14" />生成</BusyBtn>
      </form>

      <div class="sync-list" id="inviteList">
        <p v-if="!inv.list.length" class="hint">{{ inv.loading ? '加载中…' : '还没有邀请码。' }}</p>
        <div v-for="x in inv.list" :key="x.id" class="sync-row invite-row" :class="[x.status, { fresh: inv.fresh.includes(x.id) }]" :data-invite="x.code">
          <Icon name="key" :size="15" />
          <div class="grow">
            <b class="invite-code">{{ x.code }}</b>
            <span>{{ x.note ? `${x.note} · ` : '' }}{{ line(x) }}</span>
          </div>
          <template v-if="x.status === 'open'">
            <button type="button" class="btn ghost small" :data-invite-copy="x.code" @click="copy(x)"><Icon name="copy" :size="13" />复制邀请</button>
            <button type="button" class="btn danger small" :data-invite-revoke="x.code" @click="inv.revoke(x)">作废</button>
          </template>
          <span v-else class="invite-st">{{ x.status === 'used' ? '已使用' : '已作废' }}</span>
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
import { useInvitesStore } from '../stores/invites.js';
import { useBusy } from '../lib/busy.js';
import { stamp } from '../lib/text.js';
import { toast } from '../lib/feedback.js';

const inv = useInvitesStore();
const busy = useBusy();
const note = ref('');
const count = ref(1);

const line = (x) => {
  if (x.status === 'used') return `${x.used_name || '某人'} 在 ${stamp(x.used_at)} 用它注册了`;
  if (x.status === 'revoked') return `${stamp(x.revoked_at)} 作废`;
  return `${stamp(x.created_at)} 生成 · 还没用`;
};

async function make() {
  const made = await busy.run(() => inv.create(note.value.trim(), count.value));
  if (made?.length === 1) await copy(made[0]);
  note.value = '';
}
async function copy(x) {
  try {
    await navigator.clipboard.writeText(inv.messageOf(x.code));
    toast('已复制邀请（链接 + 邀请码），发给对方就行');
  } catch {
    toast(`复制失败，手动发这个码：${x.code}`);
  }
}
</script>
