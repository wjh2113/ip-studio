<template>
    <div id="hotView" class="hidden">
      <section class="card">
        <div class="card-head">
          <h2>可蹭的热点</h2>
          <div class="card-actions">
            <span class="counter" id="hotMeta"></span>
            <button class="btn primary small" id="hotRun">抓取并比对</button>
          </div>
        </div>
        <p class="hot-intro" id="hotIntro">
          抓取全网榜单，和当前账号的定位逐条比对，只留下这个号真能接得住的，并给出蹭点和选题建议。
          <em>比对只看得到榜单标题，看不到原文——动笔前请点开原文核实。伤亡、灾难、点名到个人的争议一律不推荐。</em>
        </p>
        <div class="sources" id="hotSources"></div>
        <div class="matches" id="hotMatches"></div>
      </section>

      <section class="card">
        <div class="card-head">
          <h2>抓到的原始榜单</h2>
          <div class="card-actions">
            <select id="boardFilter"></select>
            <button class="btn ghost small" id="boardRefresh">重新抓取</button>
          </div>
        </div>
        <div class="board" id="boardList"></div>
        <details class="manual">
          <summary>榜单抓不到？手动粘一份</summary>
          <p class="hint">一行一条，可以直接从任何热榜页面复制粘贴，前面的序号会自动去掉。</p>
          <textarea id="manualInput" rows="5" placeholder="1. 某某热点&#10;2. 另一个热点&#10;3. ..."></textarea>
          <button class="btn ghost small" id="manualRun">用这份榜单比对</button>
        </details>
      </section>
    </div>
</template>
