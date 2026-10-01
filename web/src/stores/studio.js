import { defineStore } from 'pinia';

/* 应用里各块共用的状态：谁登录了、站点信息、当前账号、当前稿子、在第几步、看的是创作还是热点。
 * 按业务拆出去的数据在同目录的其他 store：
 *   session 登录与启动 · account 账号设定 · brief 简报与方向 · history 创作记录 · sections 栏目
 *   frameworks 写法框架 · hot 热点 · plan 用量与支付 · jobs 后台任务 · titles 标题 · insights 回填与复盘
 *   editor 成稿区 · versions 多平台与配图 · review 成稿检查 · speak 口播 · prompter 提词器 */
export const useStudioStore = defineStore('studio', {
  state: () => ({
    user: null,
    meta: null,          // /api/meta：平台、调性、登录方式等
    llm: null,           // /api/meta 的 llm：{ live, label, model, provider }
    view: 'write',       // write 创作 | hot 热点 | library 素材库（含选题池）

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

    // 成稿区
    mode: 'read',        // read 阅读 | edit 编辑 | cue 口播
    dirty: false,        // 正文改了还没存
    revOpen: false,      // 正文历史对照展开着
    revId: null,
    revText: '',
    revisions: [],
    focusSpeakId: null,  // 展开着的那一遍口播
  }),
  getters: {
    /* 当前选中的账号设定；「全部创作」时是 null */
    currentPersona: (s) => s.personas.find((p) => p.id === s.personaId) || null,
    /* 平台 key → 中文名（meta 还没到时原样返回 key） */
    platformLabel: (s) => (key) => s.meta?.platforms?.find((p) => p.key === key)?.label || key,
  },
});
