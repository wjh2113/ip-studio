<template>
  <div class="pf-item editing" id="profileForm">
    <!-- 新增 / 修改一条经历。账号设定页整体是一个 form，这里的回车不能提交它 -->
    <div class="grid">
      <label>种类
        <select v-model="f.kind" id="profileKind">
          <option v-for="(label, k) in PROFILE_KIND" :key="k" :value="k">{{ label }}</option>
        </select>
      </label>
      <label>标题<input id="profileTitle" v-model="f.title" maxlength="60" placeholder="一句话说清这段经历" @keydown.enter.prevent /></label>
      <template v-if="f.kind !== 'opinion'">
        <label>时间<input v-model="f.period" maxlength="40" placeholder="例：2019-2022" @keydown.enter.prevent /></label>
        <label>公司 / 机构<input v-model="f.org" maxlength="60" placeholder="选填" @keydown.enter.prevent /></label>
        <label>角色<input v-model="f.role" maxlength="60" placeholder="例：运营主管" @keydown.enter.prevent /></label>
        <label>标签<input v-model="f.tags" maxlength="120" placeholder="逗号分隔，召回时权重更高" @keydown.enter.prevent /></label>
      </template>
    </div>
    <label class="full">{{ f.kind === 'opinion' ? '为什么这么认为' : '经过' }}
      <textarea v-model="f.body" rows="3" maxlength="1000" :placeholder="f.kind === 'opinion' ? '你的理由、经历过的例子' : '做了什么、怎么做的、当时怎么想的'"></textarea>
    </label>
    <label v-if="f.kind !== 'opinion'" class="full">结果<textarea v-model="f.result" rows="2" maxlength="400" placeholder="尽量带数字：转化率 2%→3.5%、团队从 5 人到 12 人"></textarea></label>
    <div class="pf-row">
      <label class="pf-vis"><input v-model="f.visibility" type="radio" value="public" />可公开（写作时可以点名机构）</label>
      <label class="pf-vis"><input v-model="f.visibility" type="radio" value="background" />只作背景（不写出机构名）</label>
      <span class="grow"></span>
      <button type="button" class="btn ghost small" @click="L.cancelEdit()">取消</button>
      <button type="button" class="btn primary small" id="profileSaveBtn" @click="L.saveEntry()">保存</button>
    </div>
  </div>
</template>

<script setup>
import { PROFILE_KIND, useLearningStore } from '../stores/learning.js';

const L = useLearningStore();
const f = L.form;
</script>
