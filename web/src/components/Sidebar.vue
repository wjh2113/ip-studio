<template>
    <aside class="sidebar">
      <div class="persona-bar">
        <div class="sidebar-head">
          <span>账号设定</span>
          <button class="btn ghost small" id="newPersonaBtn">＋ 新账号</button>
        </div>
        <!-- 默认只露头像 + 名称 + 定位；其余（目标用户、人设、语气档案…）折起来。
             侧栏是长期占屏的东西，平时不需要把整份设定摊在那儿。 -->
        <!-- 多账号时直接列出来，一行一个，不用下拉——下拉要先点开才知道有什么。
             当前账号那行展开成卡片（定位 + 齿轮 + 完整设定），其余是单行。 -->
        <div class="persona-card">
          <div class="persona-list" id="personaList"></div>
          <button class="persona-more hidden" id="personaMoreBtn" type="button" aria-expanded="false">
            展开完整设定 <i>▾</i>
          </button>
          <div class="persona-summary hidden" id="personaSummary"></div>
        </div>
      </div>

      <div class="sidebar-head">
        <span>创作记录</span>
        <button class="btn ghost small" id="newBtn">＋ 新建</button>
      </div>

      <div class="history-filter" id="historyFilter">
        <button data-arch="0" class="on">进行中<span class="n" id="cntActive"></span></button>
        <button data-arch="1">已归档<span class="n" id="cntArchived"></span></button>
        <button data-view="speaks">口播<span class="n" id="cntSpeaks"></span></button>
      </div>

      <div class="history" id="history"></div>

      <div class="history-foot hidden" id="historyFoot">
        <button class="btn ghost small" id="archiveDoneBtn">把已完成的收起来</button>
      </div>
    </aside>
</template>
