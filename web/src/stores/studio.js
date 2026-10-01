import { defineStore } from 'pinia';

/* 应用里各块共用的状态：谁登录了、站点信息、当前账号、当前稿子、在第几步、看的是创作还是热点。
 * 按业务拆出去的数据在同目录的其他 store：
 *   session 登录与启动 · account 账号设定 · brief 简报与方向 · history 创作记录 · sections 栏目
 *   frameworks 写法框架 · hot 热点 · plan 用量与支付 · jobs 后台任务 · titles 标题 · insights 回填与复盘
 *
 * 成稿区（第三步）还在 public/js：那几个模块通过 core.js 的 state（就是这里的 $state）读写同一份数据。 */
export const useStudioStore = defineStore('studio', {
  state: () => ({
    user: null,
    meta: null,          // /api/meta：平台、调性、登录方式等
    llm: null,           // /api/meta 的 llm：{ live, label, model, provider }
    view: 'write',       // write 创作 | hot 热点

    personas: [],
    personaId: null,     // null = 全部创作
    skipOnboard: false,  // 没有账号时选了「先不设定，直接创作」
    sections: [],        // 当前账号的内容栏目
    presets: [],         // 可以直接加的预设栏目
    sectionId: null,     // 本篇属于哪个栏目
    frameworkKey: null,  // 本篇用哪个写法框架
    ideaFailed: new Set(),  // 自动补推荐题材失败过的账号，本次会话不再自动重试

    draft: null,
    step: 1,
    streaming: false,    // 正在流式生成正文：期间不许切稿子、换账号

    historyMode: 'drafts',  // drafts 创作记录 | speaks 口播记录
    showArchived: false,
    speakCount: 0,

    // 成稿区（public/js）用的
    mode: 'read',        // read 阅读 | edit 编辑 | cue 口播
    dirty: false,
    assist: null,
    voiceApplying: false,
    revOpen: false,
    revId: null,
    revText: '',
    revisions: [],
    speaks: [],
    focusSpeakId: null,
  }),
  getters: {
    /* 当前选中的账号设定；「全部创作」时是 null */
    currentPersona: (s) => s.personas.find((p) => p.id === s.personaId) || null,
    /* 平台 key → 中文名（meta 还没到时原样返回 key） */
    platformLabel: (s) => (key) => s.meta?.platforms?.find((p) => p.key === key)?.label || key,
  },
});
