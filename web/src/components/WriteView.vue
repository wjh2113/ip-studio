<template>
    <div id="writeView" :class="{ hidden: s.view !== 'write' }">
      <!-- 步骤条同时是导航：走过的步骤可以点回去 -->
      <ol class="steps" id="steps">
        <li class="step active" data-step="1"><b>1</b> 确定选题</li>
        <li class="step" data-step="2"><b>2</b> 选择话题方向</li>
        <li class="step" data-step="3"><b>3</b> 创作内容</li>
      </ol>

      <!-- 引导：还没有账号设定 -->
      <section class="card onboard hidden" id="onboardCard">
        <h2>先给这个号定个位</h2>
        <p>设定账号的平台、内容方向、目标用户和要解决的问题之后，每次创作都会自动带上这份语境——
          选题不会跑偏，语气也不会每篇都换一个人。</p>
        <div class="actions">
          <button class="btn primary" id="quickBtn" type="button">贴一段自我介绍，帮我填</button>
          <button class="btn ghost" id="onboardBtn">自己一项项填</button>
          <button class="btn ghost" id="skipOnboardBtn">先不设定，直接创作</button>
        </div>
      </section>

      <!-- 第一步 -->
      <section class="card" id="briefCard">
        <div class="card-head">
          <h2>创作简报</h2>
          <span class="inherit-note" id="inheritNote"></span>
        </div>
        <form id="briefForm">
          <label class="full">题材 <span class="req">*</span>
            <textarea name="subject" rows="2" maxlength="200" required
              placeholder="自己写，或从下面挑一条"></textarea>
          </label>

          <div class="sections-pick" id="sectionPick">
            <span class="sections-label">内容栏目</span>
            <div class="section-chips" id="sectionChips"></div>
            <button type="button" class="btn ghost small" id="manageSectionsBtn">管理栏目</button>
          </div>

          <div class="section-inputs hidden" id="sectionInputs"></div>

          <FrameworkPick />

          <div class="hot-ref hidden" id="hotRef"></div>

          <!-- 选题池：热点里看到的、推荐里想留的，不当场写也不丢 -->
          <div class="pool" id="poolBox">
            <div class="ideas-head">
              <span>选题池<em id="poolNote"></em></span>
              <button class="btn ghost small" type="button" id="poolToggle">展开 ▾</button>
            </div>
            <div class="pool-list hidden" id="poolList"></div>
          </div>

          <div class="ideas" id="ideas">
            <div class="ideas-head">
              <span>推荐题材<em id="ideasNote">这个号还没写过的</em></span>
              <button class="btn ghost small" type="button" id="ideasRefresh">换一批</button>
            </div>
            <div class="ideas-list" id="ideasList"></div>
          </div>

          <!-- 默认按账号设定走，只展示不可改；点「修改」才展开成表单 -->
          <div class="inherited hidden" id="inheritRow">
            <div class="inherited-facts" id="inheritFacts"></div>
            <button type="button" class="btn ghost small" id="editParamsBtn">修改</button>
          </div>

          <div class="grid" id="paramGrid">
            <label>发布平台<select name="platform" id="platformSel"></select></label>
            <label>风格调性<select name="tone" id="toneSel"></select></label>
            <label>目标读者<input name="audience" maxlength="120" placeholder="例：一线城市上班族" /></label>
            <label>目标字数<input name="length" type="number" min="150" max="4000" step="50" /></label>
            <div class="param-reset hidden" id="paramReset">
              <button type="button" class="btn ghost small" id="resetParamsBtn">恢复账号设定</button>
            </div>
          </div>

          <label class="full">必须覆盖的关键词 / 信息点
            <input name="keywords" maxlength="300" placeholder="用逗号分隔，可留空" />
          </label>

          <div class="actions">
            <button class="btn primary" type="submit" id="topicsBtn">生成三个话题方向</button>
            <span class="hint" id="briefHint"></span>
          </div>
        </form>
      </section>

      <!-- 第二步 -->
      <section class="card hidden" id="topicsCard">
        <div class="card-head">
          <button class="btn ghost small step-back" data-goto="1">← 改题材</button>
          <h2>三个话题方向<span class="modal-sub" id="topicsFw"></span></h2>
          <button class="btn ghost small" id="retopicsBtn">换一批</button>
        </div>
        <div class="topics" id="topics"></div>
      </section>

      <!-- 第三步 -->
      <section class="card hidden" id="contentCard">
        <!-- 标题行 + 工具条吸顶：长文往下读的时候，模式切换和这几个动作始终够得着 -->
        <div class="head-stick">
        <!-- 一排八个按钮谁也找不着，按"要干什么"分三组，模式切换单独提到标题行 -->
        <div class="card-head">
          <button class="btn ghost small step-back" data-goto="2">← 换方向</button>
          <h2 id="contentTitle">完整文案</h2>
          <span class="counter" id="counter"></span>
          <span class="grow"></span>
          <!-- 模式指示器。切换动作在工具条上（修改 / 确认→生成口播 / 返回阅读），
               这里只负责说明"你现在在哪个模式" -->
          <span class="mode-now hidden" id="modeNow"></span>
        </div>

        <!-- 三个动作代替原来的八个：改 / 认了 / 拿走。
             后两个各带一个菜单，里面才是具体做什么——一次只让人做一个决定。 -->
        <div class="toolbar">
          <button class="btn ghost small hidden" id="backReadBtn">← 返回阅读</button>
          <button class="btn ghost small" id="editBtn">修改</button>
          <button class="btn ghost small" id="revBtn">版本</button>
          <div class="menu-wrap">
            <button class="btn primary small" id="confirmBtn" aria-haspopup="true">确认 ▾</button>
            <div class="menu hidden" id="confirmMenu">
              <div class="menu-head">这稿定了，接下来</div>
              <button type="button" data-act="cues">生成口播提示<em>切段、标语气，配合提词器照着念</em></button>
              <button type="button" data-act="titles">起标题<em>按不同写法出 6 个候选，挑一个替换</em></button>
              <button type="button" data-act="multi">出多平台版本<em>事实不变，按各平台重排结构和篇幅</em></button>
              <button type="button" data-act="illus">配图<em>正文写 &lt;此处放图片&gt; 就插在那里；没写则自动排位。出图要点「全部出图」</em></button>
              <button type="button" data-act="learn">喂给账号学习<em>作为语气样本，影响以后的成稿</em></button>
              <hr>
              <button type="button" data-act="review">再检查一遍<em>错字、通顺性、调性与风险</em></button>
              <button type="button" data-act="metrics">回填发布数据<em>发完填几个数字，复盘才知道什么有效</em></button>
              <button type="button" data-act="archive">归档<em>收进「已归档」，随时能恢复</em></button>
            </div>
          </div>
          <div class="menu-wrap">
            <button class="btn ghost small" id="exportBtn" aria-haspopup="true">导出 ▾</button>
            <div class="menu hidden" id="exportMenu">
              <div class="menu-head">导出格式</div>
              <button type="button" data-fmt="copy">复制<em id="copyHint">正文；有配图时连图一起（富文本）</em></button>
              <button type="button" data-fmt="md">下载 Markdown<em>纯文本，.md</em></button>
              <button type="button" data-fmt="html">下载图文<em>单个 .html，图嵌在里面</em></button>
              <button type="button" data-fmt="docx">导出 Word<em>.docx，有配图就嵌进文档</em></button>
              <button type="button" data-fmt="pdf">导出 PDF<em>走浏览器打印，在弹窗里选「另存为 PDF」</em></button>
            </div>
          </div>
          <span class="grow"></span>
          <span class="hint" id="toolHint"></span>
          <!-- 保存跟着编辑模式出现在这一行。原来在编辑区底部，
               离正文远、也和「确认/导出」这组动作脱节 -->
          <span class="save-state hidden" id="saveState"></span>
          <button class="btn ghost small hidden" id="saveBtn">保存</button>

          <!-- 这几个是原来的按钮，逻辑都还在用，只是不再直接露出来——
               上面的菜单转发点击到它们。比把几百行处理逻辑重写一遍稳妥。 -->
          <span class="hidden" aria-hidden="true">
            <button type="button" id="reviewBtn"></button>
            <button type="button" id="learnBtn"></button>
            <button type="button" id="multiBtn"></button>
            <button type="button" id="illusBtn"></button>
            <button type="button" id="copyBtn"></button>
            <button type="button" id="downloadBtn"></button>
          </span>
        </div>
        </div><!-- /.head-stick -->

        <div class="rev-pane hidden" id="revPane">
          <div class="rev-bar">
            <span>每次保存前都会留下上一版。点一版，和现在这篇对照。正文没改过不会重复记。</span>
            <span class="grow"></span>
            <button type="button" class="btn ghost small" id="revClose">收起</button>
          </div>
          <div class="rev-body">
            <div class="rev-list" id="revList"></div>
            <div class="rev-cols">
              <div class="rev-col">
                <div class="rev-col-h" id="revLeftLabel">选一版</div>
                <div class="rev-text" id="revLeft"></div>
              </div>
              <div class="rev-col">
                <div class="rev-col-h">当前正文</div>
                <div class="rev-text" id="revRight"></div>
              </div>
            </div>
          </div>
        </div>

        <div class="review hidden" id="reviewBox">
          <div class="review-head">
            <span class="review-verdict" id="reviewVerdict"></span>
            <span class="review-risk hidden" id="reviewRisk"></span>
            <span class="review-summary" id="reviewSummary"></span>
            <span class="grow"></span>
            <button class="btn ghost small hidden" id="reviewApplyAll">全部采纳</button>
            <button class="icon-btn" id="reviewClose" title="收起">×</button>
          </div>
          <div class="review-flags" id="reviewFlags"></div>
          <div class="review-list" id="reviewList"></div>
        </div>

        <!-- 多平台：一份账号设定、一篇成稿，出多个平台的版本。
             走的是适配改写而不是各平台各生成一遍——否则同一件事会变成几个不同的故事 -->
        <div class="multi-bar hidden" id="multiBar">
          <div class="multi-pick" id="multiPick"></div>
          <div class="multi-acts">
            <span class="hint" id="multiHint"></span>
            <span class="grow"></span>
            <button class="btn primary small" id="multiRunBtn">生成选中的版本</button>
          </div>
        </div>

        <div class="ver-tabs hidden" id="verTabs"></div>

        <div class="illus-bar hidden" id="illusBar">
          <span class="chip" id="illusChip"></span>
          <span class="hint" id="illusHint"></span>
          <span class="grow"></span>
          <button class="btn ghost small" id="illusPlanBtn">重新排版位</button>
          <button class="btn primary small" id="illusRunBtn">全部出图</button>
          <div class="illus-list" id="illusList"></div>
        </div>

        <article class="content" id="content"></article>
        <div class="mark-dock hidden" id="markDock">
          <span class="mark-chip" id="markBtn" draggable="true" role="button" tabindex="0"
                title="拖进正文，或点一下插到光标处">此处放图片</span>
          <button type="button" class="btn ghost small" id="voiceBtn">语音改稿</button>
          <span class="hint" id="markHint">先把光标点在要插图的地方，再把这个标签拖进去。语音改稿是说改哪里、怎么改。</span>
          <p class="voice-note hidden" id="voiceNote"></p>
        </div>
        <textarea class="editor hidden" id="editor" spellcheck="false"></textarea>

        <div class="cues hidden" id="cuesPane">
          <div class="cues-head">
            <div class="cues-overall" id="cuesOverall"></div>
            <div class="toolbar">
              <div class="tb-group">
                <span class="tb-label">自己念</span>
                <button class="btn ghost small" id="prompterBtn">提词器</button>
                <button class="btn ghost small" id="copyCuesBtn">复制口播稿</button>
              </div>
              <span class="grow"></span>
              <button class="btn primary small" id="cuesRunBtn">生成口播提示</button>
            </div>
          </div>
          <div class="cue-list" id="cueList"></div>
          <div class="speak-box" id="speakBox">
            <div class="speak-head">
              <div>
                <b>口播记录</b>
                <span class="hint" id="speakHint">上传后先做文字总评。语音测评、视频测评要点开这一遍再做。记录只有你删除才会去掉。</span>
              </div>
              <button class="btn primary small" id="speakUploadBtn" disabled>上传音视频</button>
              <input type="file" id="speakFile" hidden accept="audio/*,video/mp4,video/webm,.mp3,.wav,.m4a,.webm,.mp4,.ogg" />
            </div>
            <div id="speakList"></div>
          </div>
        </div>

        <div class="editor-bar hidden" id="editorBar">
          <span class="hint">选中文字 → 调 AI 改写　·　输入 <kbd>/</kbd> → 让 AI 接着写</span>
        </div>
      </section>
    </div>
</template>

<script setup>
import { useStudioStore } from '../stores/studio.js';
import FrameworkPick from './FrameworkPick.vue';

const s = useStudioStore();
</script>
