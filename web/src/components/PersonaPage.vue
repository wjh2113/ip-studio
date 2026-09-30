<template>
<div class="account-page hidden" id="personaModal">
  <form id="personaForm">
    <header class="acc-head">
      <button class="icon-btn" type="button" id="personaCloseBtn" title="返回">←</button>
      <h2 id="personaModalTitle">账号设定</h2>
      <span class="grow"></span>
      <span class="hint" id="personaSaveHint"></span>
      <button class="btn danger ghost hidden" type="button" id="personaDeleteBtn">删除账号</button>
      <button class="btn ghost" type="button" id="personaCancelBtn">取消</button>
      <button class="btn primary" type="submit" id="personaSaveBtn">保存</button>
    </header>

    <div class="acc-body">
      <nav class="acc-nav" id="accountNav"></nav>

      <div class="acc-main">
        <p class="form-error" id="personaError"></p>

        <section class="acc-panel" data-panel="basic">
          <p class="quick-tip hidden" id="quickTip">不想一项项填？<a href="#" id="quickLink">贴一段自我介绍，帮你填好</a></p>
          <label class="full">账号名称 <span class="req">*</span>
            <input name="name" required maxlength="40" placeholder="例：下班后的厨房" />
          </label>

          <div class="grid">
            <label>发布平台<select name="platform" id="personaPlatform"></select></label>
            <label>风格调性<select name="tone" id="personaTone"></select></label>
          </div>

          <label class="full">主要内容
            <textarea name="content_focus" rows="2" maxlength="500"
              placeholder="这个号主要写什么。例：工作日 30 分钟内能做完的家常菜，侧重备菜和一锅出"></textarea>
          </label>

          <label class="full">目标用户
            <textarea name="audience" rows="2" maxlength="500"
              placeholder="给谁看。例：25-35 岁独居或两人住的上班族，会做饭但没时间"></textarea>
          </label>

          <label class="full">解决的问题
            <textarea name="problem" rows="2" maxlength="500"
              placeholder="读者的痛点。例：下班太累不想做饭，又不想天天点外卖"></textarea>
          </label>

          <label class="full">备注 / 禁忌
            <textarea name="notes" rows="2" maxlength="800"
              placeholder="固定要求或不能写的东西。例：不推广付费课程；每篇结尾带一句用量提醒"></textarea>
          </label>
        </section>

        <section class="acc-panel hidden" data-panel="persona">
          <fieldset class="subsection">
            <legend>个人人设<span>选填 · 决定第一人称用谁的口吻、拿什么举例</span></legend>

            <div class="grid">
              <label>年龄<input name="creator_age" maxlength="20" placeholder="例：32，或 30 岁出头" /></label>
              <label>性别
                <select name="creator_gender">
                  <option value="">不设定</option>
                  <option value="男">男</option>
                  <option value="女">女</option>
                  <option value="其他">其他</option>
                </select>
              </label>
              <label>所在行业<input name="creator_industry" maxlength="60" placeholder="例：互联网" /></label>
              <label>岗位<input name="creator_role" maxlength="60" placeholder="例：产品经理" /></label>
            </div>

            <label class="full">性格特征
              <textarea name="creator_traits" rows="2" maxlength="300"
                placeholder="例：说话直接不绕弯，爱吐槽，怕麻烦所以什么都想找省事的做法"></textarea>
            </label>
          </fieldset>
        </section>

        <section class="acc-panel hidden" data-panel="material">
          <fieldset class="subsection">
            <legend>素材库<span>你的真实经历、数据、案例——写作时按题材自动召回</span></legend>

            <div class="mat-add">
              <select id="matKind"></select>
              <input id="matTitle" maxlength="80" placeholder="一句话说清这条是什么，例：第一次带团队把人带走一半">
              <textarea id="matBody" rows="3" maxlength="4000"
                placeholder="具体细节：时间、数字、当时怎么想的、结果如何。越具体，写进稿子时越像真的。"></textarea>
              <div class="mat-add-foot">
                <input id="matTags" maxlength="200" placeholder="标签，逗号分隔（召回时权重更高）">
                <button class="btn primary small" type="button" id="matSaveBtn">存进素材库</button>
              </div>
              <p class="form-error" id="matError"></p>
            </div>

            <div class="mat-list" id="matList"></div>
            <p class="hint" id="matHint"></p>
          </fieldset>
        </section>

        <section class="acc-panel hidden" data-panel="style">
          <fieldset class="subsection hidden" id="styleSection">
            <legend>语气样本<span>喂几篇成稿，让它学你真实的语感</span></legend>
            <div class="sample-list" id="sampleList"></div>
            <div class="digest-box" id="digestBox"></div>
            <div class="sample-actions">
              <button class="btn ghost small" type="button" id="rebuildDigestBtn">重新学习</button>
              <span class="hint" id="styleHint"></span>
            </div>
          </fieldset>
        </section>
      </div>
    </div>
  </form>
</div>
</template>
