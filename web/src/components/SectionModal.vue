<template>
<div class="modal-mask hidden" id="sectionModal">
  <div class="modal">
    <div class="modal-head">
      <h2>内容栏目<span class="modal-sub" id="sectionModalSub"></span></h2>
      <button class="icon-btn" id="sectionModalClose" title="关闭">×</button>
    </div>

    <div class="modal-body">
      <p class="hint">给这个号分几条内容线，创作时可以指定本篇属于哪条。不选就是常规创作。</p>

      <div class="section-list" id="sectionList"></div>

      <div class="section-add">
        <select id="sectionPreset"></select>
        <button class="btn ghost small" type="button" id="sectionAddBtn">添加</button>
      </div>

      <div class="section-form hidden" id="sectionForm">
        <label class="full">栏目名 <span class="req">*</span>
          <input id="sectionName" maxlength="20" placeholder="例：来时路" />
        </label>
        <label class="full">这个栏目讲什么
          <textarea id="sectionPurpose" rows="2" maxlength="300"
            placeholder="例：讲清楚这个号是怎么来的、为什么是我在做、和别人的不一样在哪"></textarea>
        </label>
        <label class="full">写作要点
          <textarea id="sectionGuide" rows="3" maxlength="600"
            placeholder="这个栏目该怎么写、不该怎么写"></textarea>
        </label>
        <label class="full">默认写法框架
          <select id="sectionFramework"><option value="">不指定</option></select>
          <span class="hint">选这个栏目创作时自动带上，简报里还能换</span>
        </label>

        <div class="field-editor">
          <div class="field-editor-head">
            <span>写这个栏目时需要你提供的素材</span>
            <button type="button" class="btn ghost small" id="fieldAddBtn">＋ 加一项</button>
          </div>
          <p class="hint">比如「来时路」需要你的背景经历。创作时选中这个栏目就会问你要，模型只能用你填的，不会自己编。</p>
          <div class="field-rows" id="fieldRows"></div>
        </div>

        <p class="form-error" id="sectionError"></p>
        <div class="section-form-foot">
          <button class="btn ghost small" type="button" id="sectionCancelBtn">取消</button>
          <button class="btn primary small" type="button" id="sectionSaveBtn">保存栏目</button>
        </div>
      </div>
    </div>
  </div>
</div>
</template>
