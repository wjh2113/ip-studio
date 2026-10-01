import { defineStore } from 'pinia';

/* 和原来 public/js/core.js 里的 state 是同一份字段（core.js 里 state = useStudioStore().$state）。
 * 功能模块通过 core.js 读写，组件通过这个 store 读写，指向同一份。
 *
 * 按业务拆出去的数据在同目录的其他 store（plan 用量、jobs 任务、titles 标题、insights 回填与复盘）。
 * 还没迁完的界面是 public/js 里的模块按 id 找元素、拼 HTML。迁移规则见 docs/ARCHITECTURE.md。 */
export const useStudioStore = defineStore('studio', {
  state: () => ({
    user: null,
    meta: null,
    draft: null,
    streaming: false,
    busy: false,
    personas: [],
    personaId: null,
    editingId: null,
    skipOnboard: false,
    frameworkKey: null,
    mode: 'read',
    dirty: false,
    assist: null,
    ideaFailed: new Set(),
    voiceApplying: false,
    revOpen: false,
    revId: null,
    revText: '',
    revisions: [],
    view: 'write',
    boards: null,
    paramsUnlocked: false,
    sections: [],
    sectionId: null,
    editingSection: null,
    presets: [],
    sectionPersonaId: null,
    showArchived: false,
    historyMode: 'drafts',
    counts: { active: 0, archived: 0, activeDone: 0 },
    speaks: [],
    focusSpeakId: null,
    step: 1,
    // 以下由 Vue 组件渲染：功能模块只改数据，不要再去碰对应的 DOM
    llm: null,          // /api/meta 的 llm：{ live, label, model, provider }（TopBar）
    list: [],           // 左侧创作记录（Sidebar）
    speakCount: 0,      // 口播记录条数（Sidebar 筛选上的数字）
    archivingDone: false, // 「把已完成的收起来」进行中（Sidebar）
  }),
  getters: {
    /* 平台 key → 中文名（meta 还没到时原样返回 key） */
    platformLabel: (s) => (key) => s.meta?.platforms?.find((p) => p.key === key)?.label || key,
  },
});
