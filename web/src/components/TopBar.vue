<template>
  <header class="topbar">
    <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>文案工坊</span></div>
    <nav class="tabs-nav" id="viewNav">
      <button data-view="write" class="active">创作</button>
      <button data-view="hot">热点</button>
    </nav>
    <div class="topbar-right">
      <span class="chip" id="llmChip" title="当前模型通道">…</span>
      <button class="btn ghost small jobs-btn" id="jobsBtn" type="button" title="出图、口播转写与评测这类要等的活，关掉页面也会接着做">任务<span class="jobs-badge hidden" id="jobsBadge"></span></button>
      <button class="credit-chip" id="creditChip" title="点开看用量与套餐"></button>
      <span class="user-name" id="userName"></span>
      <a class="btn ghost small" href="/prompts" target="_blank" rel="noopener"
         title="每条提示词的产品定位、价值与功能逻辑">说明书</a>
      <button class="btn ghost small" id="logoutBtn">退出</button>
    </div>
  </header>
</template>
