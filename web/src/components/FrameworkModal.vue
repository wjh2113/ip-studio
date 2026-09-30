<template>
<div class="modal-mask hidden" id="fwModal">
  <div class="modal fw-modal">
    <div class="modal-head">
      <h2>框架库<span class="modal-sub">写法的结构：每段干什么、各占多少篇幅</span></h2>
      <button class="icon-btn" id="fwClose" title="关闭">×</button>
    </div>
    <div class="modal-body">
      <div class="fw-bar">
        <div class="fw-tabs" id="fwTabs">
          <button type="button" data-tab="all" class="on">全部</button>
          <button type="button" data-tab="mine">我的</button>
          <button type="button" data-tab="builtin">内置</button>
        </div>
        <select id="fwPlatform"></select>
        <button type="button" class="btn ghost small" id="fwExtractBtn">从范文拆解</button>
        <button type="button" class="btn primary small" id="fwNewBtn">＋ 新建框架</button>
      </div>
      <div class="fw-extract hidden" id="fwExtract">
        <p class="hint">贴一篇你觉得写得好的文案（自己的爆款、收藏的范文都行），拆出它的结构。只拆结构不拆内容；原文会随框架保存，用来检查以后的稿子有没有和它雷同。</p>
        <textarea id="fwSource" rows="8" maxlength="8000" placeholder="粘贴范文，至少 150 字"></textarea>
        <div class="fw-bar">
          <label class="btn ghost small fw-file">读取 .txt / .md 文件<input type="file" id="fwFile" accept=".txt,.md,text/plain,text/markdown" hidden /></label>
          <select id="fwSourcePlatform"></select>
          <span class="hint" id="fwSourceCount"></span>
          <span class="grow"></span>
          <button type="button" class="btn ghost small" id="fwExtractCancel">取消</button>
          <button type="button" class="btn primary small" id="fwExtractRun">拆解</button>
        </div>
      </div>
      <div class="fw-list" id="fwList"></div>

      <div class="fw-editor hidden" id="fwEditor">
        <label class="full">框架名 <span class="req">*</span><input id="fwName" maxlength="30" placeholder="例：我的种草五段式" /></label>
        <label class="full">一句话说明<input id="fwSummary" maxlength="200" placeholder="适合什么内容、为什么好用" /></label>
        <div class="fw-plats" id="fwPlats"></div>
        <label class="full">适用场景<input id="fwScenes" maxlength="60" placeholder="用逗号分隔，例：种草，好物（推荐时会按它和题材匹配）" /></label>
        <div class="field-editor">
          <div class="field-editor-head">
            <span>段落（按顺序）</span>
            <button type="button" class="btn ghost small" id="fwSlotAdd">＋ 加一段</button>
          </div>
          <p class="hint">每段写清作用和要点，篇幅填百分比（会自动按比例换算，不必凑满 100）。</p>
          <div class="fw-slots" id="fwSlots"></div>
          <div class="fw-bar-preview" id="fwPreview"></div>
        </div>
        <p class="hint hidden" id="fwWhy"></p>
        <p class="form-error" id="fwError"></p>
        <div class="section-form-foot">
          <button class="btn ghost small" type="button" id="fwCancel">取消</button>
          <button class="btn primary small" type="button" id="fwSave">保存框架</button>
        </div>
      </div>
    </div>
  </div>
</div>
</template>
