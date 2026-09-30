<template>
<div class="modal-mask hidden" id="planModal">
  <div class="modal wide">
    <div class="modal-head">
      <h2>用量与套餐<span class="modal-sub" id="planPeriod"></span></h2>
      <button class="icon-btn" id="planClose" title="关闭">×</button>
    </div>
    <div class="modal-body">
      <div class="plan-now" id="planNow"></div>
      <h3 class="plan-h">本月花在哪了</h3>
      <div id="planBreakdown"></div>
      <h3 class="plan-h">套餐</h3>
      <div class="plan-cards" id="planCards"></div>
      <p class="hint" id="planNote"></p>

      <!-- 支付。扫码 + 轮询订单状态——回调可能丢，不能只等推送 -->
      <div class="paybox hidden" id="payBox">
        <div class="pay-head">
          <b id="payTitle"></b>
          <span class="grow"></span>
          <button class="icon-btn" id="payCancel" title="取消">×</button>
        </div>
        <div class="pay-body">
          <div class="pay-qr" id="payQr"></div>
          <div class="pay-side">
            <div class="pay-ch" id="payChannels"></div>
            <p class="hint" id="payHint"></p>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
</template>
