<template>
<div class="modal-mask hidden" id="metricsModal">
  <div class="modal">
    <div class="modal-head">
      <h2>回填发布数据<span class="modal-sub">发完填一下，复盘才知道什么有效</span></h2>
      <button class="icon-btn" id="metricsClose" title="关闭">×</button>
    </div>
    <div class="modal-body">
      <div class="grid">
        <label>发布日期<input type="date" id="metricsDate"></label>
        <label>这次记录的日期<input type="date" id="metricsOn"></label>
        <label class="full hidden" id="metricsPlatformRow">哪个平台的数<select id="metricsPlatform"></select></label>
      </div>
      <div class="grid" id="metricsFields"></div>
      <label class="full">备注<textarea id="metricsNote" rows="2" maxlength="300"
        placeholder="选填。例：这条被大号转了；标题改过一版；发的时间比平时晚"></textarea></label>
      <p class="hint">可以隔几天再填一次，每次存一份，复盘时能看走势、按「发布后第 7 天」同口径比。同一天再填会覆盖当天那份；全部清空并保存 = 删掉当天那份。</p>
      <div class="metrics-history" id="metricsHistory"></div>
      <div class="modal-foot">
        <a class="btn ghost" href="#" id="insightsLink">看复盘 →</a>
        <span class="grow"></span>
        <button class="btn primary" type="button" id="metricsSave">保存</button>
      </div>
    </div>
  </div>
</div>
</template>
