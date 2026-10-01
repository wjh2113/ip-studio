<template>
  <header class="lp-nav">
    <div class="lp-in">
      <span class="brand"><span class="brand-mark" aria-hidden="true"></span><span>自媒体助手</span></span>
      <span class="grow"></span>
      <a class="lp-link" href="#how">功能</a>
      <a class="lp-link" href="#price">价格</a>
      <a class="lp-link" href="/prompts">提示词说明书</a>
      <a class="lp-link strong" href="/">登录</a>
    </div>
  </header>

  <main>
    <!-- 首屏只留四样：品牌、一句主标题、一句副标题、一组按钮（加一句免费档说明）。功能列表不进首屏 -->
    <section class="lp-hero">
      <div class="lp-in">
        <h1 class="lp-brand">自媒体助手</h1>
        <p class="lp-title">AI 写的东西一眼假，不是因为它不会写</p>
        <p class="lead">是因为它不了解你的号，也不知道你真实经历过什么——这里把这两件事变成账号的资产，<b>用得越久，越像你写的</b>。</p>
        <div class="lp-cta">
          <a class="btn primary lg" href="/">登录进入<Icon name="arrow-right" :size="16" /></a>
          <a class="btn ghost lg" href="#how">先看怎么工作<Icon name="play" :size="13" /></a>
        </div>
        <p class="lp-fine"><Icon name="check-circle" :size="15" />免费档不需要绑卡，够写几十篇稿子。文章配图是付费功能。</p>

        <!-- 产品预览：选题方向三选一。纯 CSS 画的，不是截图——截图会随产品变化过期，暗色模式下也会打架 -->
        <div class="lp-shot" aria-hidden="true">
          <div class="lp-shot-side">
            <span class="brand"><span class="brand-mark"></span><span>自媒体助手</span></span>
            <i class="on">创作</i><i>热点</i><i>账号设定</i><i>创作记录</i>
          </div>
          <div class="lp-shot-body">
            <div class="lp-shot-steps"><span class="done">✓ 确定选题</span><span class="on"><b>2</b>选择话题方向</span><span><b>3</b>创作内容</span></div>
            <h4 class="lp-shot-h">三个话题方向</h4>
            <div class="lp-shot-cards">
              <div class="lp-shot-card on">
                <span class="lp-shot-tag"><b>1</b>反常识</span>
                <h5>AI 14 天造芯片，最先慌的不是芯片厂，是你公司的技术总监</h5>
                <p><em>差异</em>从 AI 造芯片切入，讲依赖技术壁垒的岗位，而不是行业颠覆。</p>
                <span class="lp-shot-btn">重新生成这篇</span>
              </div>
              <div class="lp-shot-card t1">
                <span class="lp-shot-tag"><b>2</b>行业视角</span>
                <h5>AI 造芯片背后，是每个行业都在发生的「去黑盒化」</h5>
                <p><em>差异</em>从老师傅经验讲起，落到每个行业都在发生的变化。</p>
                <span class="lp-shot-btn ghost">用这个方向写</span>
              </div>
              <div class="lp-shot-card t2">
                <span class="lp-shot-tag"><b>3</b>个人经历</span>
                <h5>我在芯片厂干了五年，这条新闻我看了三遍</h5>
                <p><em>差异</em>用作者自己素材库里的经历，第一人称讲。</p>
                <span class="lp-shot-btn ghost">用这个方向写</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 对比：说人话，不堆形容词 -->
    <section class="lp-in lp-vs">
      <h2 class="lp-h2">通用 AI vs 自媒体助手</h2>
      <div class="lp-table">
        <div class="lp-tr head"><span>对比维度</span><span>通用 AI</span><span><span class="brand-mark sm"></span>自媒体助手</span></div>
        <div class="lp-tr"><span>理解账号</span><span>不知道你是谁，每篇都是同一个语气，换个号也能发</span><span>按这个号的定位、栏目和你的人设写，喂几篇旧稿学你的语感</span></div>
        <div class="lp-tr"><span>内容可靠</span><span>编一个没发生过的案例来举例</span><span><b>只用你提供的真实素材</b>，不许编造之外的经历、时间、数字</span></div>
        <div class="lp-tr"><span>文字质感</span><span>「在当今快速发展的时代」这类开头</span><span>先出三个角度不同的方向，选定再写；成稿后自动检查套话和风险</span></div>
        <div class="lp-tr"><span>写完之后</span><span>改平台版本、拆口播稿还得自己来</span><span>一路做到多平台版本、配图、口播提示和提词器</span></div>
      </div>
    </section>

    <!-- 三块核心能力。每块都给一个具体的、可验证的说法，不说空话 -->
    <section class="lp-in" id="how">
      <h2 class="lp-h2">三件让它不一样的事</h2>

      <div class="lp-feat">
        <div class="lp-feat-t">
          <span class="lp-num">01</span>
          <h3>账号语境，越用越准</h3>
          <p>
            账号设定、个人人设、内容栏目、语气档案——每次创作都会把这些拼进去。
            语气档案是从你自己写的稿子里蒸馏出来的：句长偏好、口头禅、人称、开头收尾的习惯。
          </p>
          <p class="lp-note">
            这不是"记住偏好"这种话术。你可以在提示词说明书里看到
            <a href="/prompts">每次实际发出去的上下文是怎么拼的</a>。
          </p>
        </div>
        <div class="lp-feat-v">
          <div class="lp-stack">
            <div><b>账号定位</b><i>平台 / 风格 / 目标用户 / 禁忌</i></div>
            <div><b>个人人设</b><i>45 岁 · 互联网 · 总裁 · 爱吐槽</i></div>
            <div><b>栏目要点</b><i>「来时路」讲来历和差异，不写成教程</i></div>
            <div class="hi"><b>栏目素材</b><i>唯一可信的事实来源</i></div>
            <div class="hi"><b>素材库召回</b><i>按题材召回最相关的几条</i></div>
            <div><b>语气档案</b><i>句长 15–30 字，少量短句制造节奏</i></div>
            <div><b>平台规范</b><i>公众号 1400 字，小标题分节</i></div>
          </div>
          <p class="lp-cap">每次调用实际拼进 user 消息的七层上下文</p>
        </div>
      </div>

      <div class="lp-feat">
        <div class="lp-feat-t">
          <span class="lp-num">02</span>
          <h3>素材库：它不能编造</h3>
          <p>
            把你的真实经历、数据、案例存进素材库，写作时按题材自动召回相关的几条。
            提示词里写死一条：<b>这些是唯一可信的事实来源，不许编造它们之外的经历、时间、数字、人物</b>。
          </p>
          <p class="lp-note">
            实测：存了「客服工单从 4.2 小时降到 47 分钟」「8 人小组三个月走了 4 个」之后，
            写出来的稿子把这些具体数字原样用上了；不相关的素材不会被硬塞进来。
          </p>
        </div>
        <div class="lp-feat-v">
          <div class="lp-mat"><span class="k">数据</span>我们组用 AI 后的真实数据
            <i>响应从 4.2 小时降到 47 分钟，人力只减了 1 个</i>
            <em>用过 3 次</em></div>
          <div class="lp-mat"><span class="k">经历</span>第一次带团队把人带走一半
            <i>8 人小组，三个月走了 4 个</i>
            <em>用过 1 次</em></div>
          <div class="lp-mat off"><span class="k">观察</span>家常菜最难的是备菜时间
            <i>和这次题材无关，不会被硬塞进来</i></div>
          <p class="lp-cap">素材越厚，能写的真东西越多</p>
        </div>
      </div>

      <div class="lp-feat">
        <div class="lp-feat-t">
          <span class="lp-num">03</span>
          <h3>写完不是终点</h3>
          <p>
            口播提示把稿子切成一口气能念完的段落，标好语气、重读和停顿，全屏提词器照着念。
            还能一稿改成多个平台的版本——<b>改写而不是重新生成</b>，几个版本讲的是同一件事。
          </p>
          <p class="lp-note">
            多平台走的是适配改写：经历、数字、案例一个都不许动，只重排结构和语气——
            读者跨平台对照也不露馅。
          </p>
        </div>
        <div class="lp-feat-v">
          <div class="lp-flow">
            <span class="src">成稿</span><i>→</i><span>口播提示</span><i>→</i><span class="end">提词器</span>
          </div>
          <div class="lp-flow">
            <span class="src">成稿</span><i>→</i><span>公众号 1810字</span><span>小红书 653字</span><span>微博 281字</span>
          </div>
          <p class="lp-cap">同一份稿子的两条下游 · 字数是实测</p>
        </div>
      </div>
    </section>

    <!-- 技术可信度。这一段是给懂行的人看的，也是最难被抄的部分 -->
    <section class="lp-band lp-principle">
      <div class="lp-in">
        <h2 class="lp-h2">一条贯穿始终的原则</h2>
        <p class="lp-big">看得见的失败，一律不靠模型自律。</p>
        <p class="lp-lead2">
          每条提示词之外都有一层代码兜底——枚举、正则、白名单、二次校验。因为实测下来，
          模型在"给点建议"的压力下一定会凑数，在"不要碰红线话题"的要求下照样会给。
        </p>
        <div class="lp-cases">
          <div><b>成稿检查</b>丢掉全部「低」档 + 正则过滤「符合…但…」式的凑数句</div>
          <div><b>热点比对</b>红线话题在送进模型之前就被代码过滤掉</div>
          <div><b>口播提示</b>引用必须能在正文里逐字找到，找不到整条丢弃</div>
          <div><b>图文配图</b>张数按字数硬卡——提示词写了"宁可少插"，实测 281 字照样给 3 张</div>
        </div>
        <p class="lp-note">
          这些判断是怎么来的、在哪里翻过车，都写在
          <a href="/prompts">提示词说明书</a>里，公开可读。
        </p>
      </div>
    </section>

    <!-- 定价。老实说清楚什么要钱 -->
    <section class="lp-in" id="price">
      <h2 class="lp-h2">价格</h2>
      <p class="lp-sub">按点数计费，写稿很便宜，出图是大头。用不到的功能不占额度。</p>
      <div class="lp-price" id="lpPrice">
        <p v-if="priceError" class="lp-note">价格暂时取不到，稍后再看。</p>
        <div v-for="p in plans" :key="p.key" class="lp-plan" :class="{ hot: p.key === 'pro' }">
          <h4>{{ p.label }}</h4>
          <div class="p"><template v-if="p.price">{{ p.price }}<em> 元{{ p.pack ? '' : '/月' }}</em></template><template v-else>0<em> 元/月</em></template></div>
          <div class="c">{{ p.credits.toLocaleString() }} 点</div>
          <p class="n">{{ p.note || '' }}</p>
          <a class="btn small" :class="p.key === 'pro' ? 'primary' : 'ghost'" href="/">{{ p.price ? '登录使用' : '登录进入' }}</a>
        </div>
      </div>
      <p class="lp-fine">
        免费档刻意不含出图——那是按张真金白银计费的；写稿的额度足够试出价值。
      </p>
    </section>

    <!-- 现状：不装。这个阶段的诚实比包装更能建立信任 -->
    <section class="lp-band">
      <div class="lp-in lp-status">
        <h2 class="lp-h2">这个产品现在什么状态</h2>
        <div class="lp-cols">
          <div>
            <h4>已经能用</h4>
            <ul class="lp-good">
              <li>账号设定、素材库、选题到成稿的全流程</li>
              <li>热点比对、成稿检查、多平台改写、文章配图</li>
              <li>口播提示、提词器、发布数据回填与复盘</li>
            </ul>
          </div>
          <div>
            <h4>还没做完</h4>
            <ul class="lp-bad">
              <li>支付还没接通，付费档暂时开不了</li>
              <li>自动发布做不了——平台开放接口要企业主体</li>
              <li>发布数据要手动回填，没有自动抓取</li>
            </ul>
          </div>
        </div>
      </div>
    </section>

    <section class="lp-in lp-end">
      <h2 class="lp-h2">先写一篇看看</h2>
      <p class="lp-sub">免费档不用绑卡，够写几十篇稿子。</p>
      <a class="btn primary" href="/">登录进入</a>
    </section>
  </main>

  <footer class="lp-foot">
    <div class="lp-in">
      <div class="lp-foot-brand">
        <span class="brand"><span class="brand-mark" aria-hidden="true"></span><span>自媒体助手</span></span>
        <p>懂你的账号，帮你做出更好的内容</p>
      </div>
      <div class="lp-foot-col"><b>产品</b><a href="#how">功能</a><a href="#price">价格</a><a href="/">登录</a></div>
      <div class="lp-foot-col"><b>资源</b><a href="/prompts">提示词说明书</a></div>
    </div>
    <div class="lp-in lp-copy">© 自媒体助手</div>
  </footer>
</template>

<script setup>
/* 落地页（/about，未登录访问 / 也是它）：说清楚和别的 AI 写作工具差在哪。
 * 动态的只有一件事：价格从服务端取——写死在页面里迟早和后台对不上，那种不一致比不显示价格更伤信任。 */
import { onMounted, ref } from 'vue';
import { reveal } from '../lib/reveal.js';
import Icon from '../components/common/Icon.vue';

const plans = ref([]);
const priceError = ref(false);

onMounted(async () => {
  reveal('.lp-feat, .lp-cases > div, .lp-cols > div, .lp-tr, .lp-end');
  try {
    const d = await (await fetch('/api/pricing')).json();
    plans.value = [...d.plans, ...d.packs];
    setTimeout(() => reveal('.lp-plan'), 0);
  } catch {
    priceError.value = true;
  }
});
</script>
