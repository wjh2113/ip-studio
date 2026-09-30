<template>
<div class="modal-mask hidden" id="quickModal">
  <div class="modal">
    <div class="modal-head">
      <h2>贴一段自我介绍<span class="modal-sub">先帮你把账号设定填出来，你再改</span></h2>
      <button class="icon-btn" id="quickClose" title="关闭">×</button>
    </div>
    <div class="modal-body">
      <label class="full">自我介绍
        <textarea id="quickIntro" rows="6" maxlength="3000"
          placeholder="例：我做了 8 年产品经理，二胎妈妈。在小红书写职场妈妈怎么安排时间，读者大多是 30 岁上下、刚回职场的女性。不想写鸡汤，想写能照着做的。"></textarea>
      </label>
      <label class="full">以前写过的文章（选填）
        <textarea id="quickPosts" rows="6"
          placeholder="贴 1～5 篇，篇与篇之间单独一行写 ---&#10;会存成语气样本，之后的成稿更像你自己写的"></textarea>
      </label>
      <p class="hint">只填介绍里看得出来的，看不出来的留空，不替你编年龄和经历。结果先放进账号设定给你改，改好再保存。</p>
      <p class="form-error" id="quickError"></p>
      <div class="modal-foot">
        <span class="grow"></span>
        <button class="btn primary" type="button" id="quickRun">帮我填好</button>
      </div>
    </div>
  </div>
</div>
</template>
