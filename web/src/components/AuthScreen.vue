<template>
<div id="authScreen" class="auth-screen hidden">
  <div class="auth-card">
    <div class="brand"><span class="brand-mark" aria-hidden="true"></span><span>文案工坊</span></div>
    <p class="auth-sub" id="authSub">给一个题材，先出三个话题方向，选中后生成完整成稿。</p>

    <div class="tabs" id="authTabs">
      <button class="tab active" data-mode="login">登录</button>
      <button class="tab" data-mode="register" id="registerTab">注册</button>
    </div>

    <form id="authForm" autocomplete="on">
      <label id="userRow">用户名<input name="username" required maxlength="24" placeholder="2-24 位，支持中英文" autocomplete="username" /></label>
      <label>密码<input name="password" type="password" required minlength="6" placeholder="至少 6 位" autocomplete="current-password" /></label>
      <label id="inviteRow" class="hidden">邀请码<input name="invite" maxlength="40" placeholder="需要邀请码才能注册" autocomplete="off" /></label>
      <p class="form-error" id="authError"></p>
      <button class="btn primary block" type="submit" id="authSubmit">登录</button>
    </form>
    <p class="auth-tip" id="authTip">每个账号的创作记录相互独立。</p>
  </div>
</div>
</template>
