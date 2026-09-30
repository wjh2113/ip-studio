<template>
<div class="assist-pop hidden" id="assistPop">
  <div class="assist-head">
    <span id="assistTitle">AI 改写</span>
    <button class="icon-btn" id="assistClose" title="关闭">×</button>
  </div>
  <div class="assist-body" id="assistBody"></div>
  <div class="assist-foot">
    <button class="btn ghost small" id="assistRetry">重来一次</button>
    <span class="grow"></span>
    <button class="btn ghost small" id="assistInsert">插入到后面</button>
    <button class="btn primary small" id="assistReplace">替换原文</button>
  </div>
</div>
</template>
