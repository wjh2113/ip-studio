<template>
<div class="modal-mask hidden" id="titleModal">
  <div class="modal">
    <div class="modal-head">
      <h2>标题候选<span class="modal-sub" id="titleSub"></span></h2>
      <button class="icon-btn" id="titleClose" title="关闭">×</button>
    </div>
    <div class="modal-body">
      <div class="title-list" id="titleList"></div>
      <div class="section-form-foot">
        <button class="btn ghost small" type="button" id="titleAgain">换一批</button>
      </div>
    </div>
  </div>
</div>
</template>
