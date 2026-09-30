<template>
<div class="prompter hidden" id="prompter">
  <div class="prompter-bar">
    <button class="pbtn" id="pPlay" title="空格">▶ 开始</button>
    <button class="pbtn" id="pRec" title="录这一遍，停下来就去总评">● 录</button>
    <div class="pgroup">
      <span>速度</span>
      <button class="pbtn sm" data-speed="-1" title="[">−</button>
      <b id="pSpeedVal">40</b>
      <button class="pbtn sm" data-speed="1" title="]">＋</button>
    </div>
    <div class="pgroup">
      <span>字号</span>
      <button class="pbtn sm" data-size="-1" title="减号">−</button>
      <b id="pSizeVal">40</b>
      <button class="pbtn sm" data-size="1" title="加号">＋</button>
    </div>
    <button class="pbtn" id="pCues" title="C">提示 开</button>
    <button class="pbtn" id="pMirror" title="M">镜像</button>
    <button class="pbtn" id="pRestart" title="R">⟲ 重来</button>
    <span class="pgrow"></span>
    <span class="pprogress" id="pProgress">0%</span>
    <button class="pbtn" id="pClose" title="Esc">✕ 退出</button>
  </div>

  <div class="prompter-stage" id="pStage">
    <div class="prompter-line"></div>
    <div class="prompter-scroll" id="pScroll">
      <div class="prompter-body" id="pBody"></div>
    </div>
  </div>

  <div class="prompter-help">
    空格 播放/暂停　·　● 录这一遍，再按一次停止并评分　·　<b>↑↓ 挪动画面</b>（滚轮同）　·　PgUp/PgDn 翻页　·　[ ] 速度　·　+− 字号　·　C 提示　·　M 镜像　·　R 重来　·　Esc 退出
  </div>
</div>
</template>
