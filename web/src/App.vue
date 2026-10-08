<template>
  <AuthScreen />

  <div id="app" class="app" :class="{ hidden: !s.user }">
    <TopBar />
    <div class="layout" :class="{ 'no-side': s.view === 'frameworks', 'side-folded': sideFolded }">
      <!-- 框架库自带管理界面，不叠侧栏；素材库的侧栏上半截换成素材分类（见 Sidebar / MaterialKinds） -->
      <Sidebar v-show="s.view !== 'frameworks' && !sideFolded" />
      <!-- 创作页收起左栏后留一条窄边：展开、新建 -->
      <div v-if="sideFolded" class="side-rail" id="sideRail">
        <button type="button" class="rail-btn" id="sideExpandBtn" title="展开账号与创作记录" aria-label="展开左栏" @click="layout.toggleSide()"><Icon name="chev-right" :size="16" /></button>
        <span class="rail-label">账号 · 创作记录</span>
      </div>
      <!-- 宽度按步骤走，见 .main[data-step] -->
      <main class="main" id="main" :data-step="s.view === 'write' ? s.step : undefined" :data-view="s.view">
        <WriteView />
        <HotView />
        <SpeakView />
        <MaterialsView />
        <FrameworksView />
      </main>
    </div>
  </div>

  <SelMenu />
  <SlashMenu />
  <AssistPop />
  <SectionModal />
  <QuickstartModal />
  <JobsModal />
  <TitleModal />
  <PersonaPage />
  <ProfilePage />
  <PlanModal />
  <MetricsModal />
  <InsightsModal />
  <Prompter />
  <SyncModal />
  <InviteModal />

  <Toast />
  <AskDialog />
</template>

<script setup>
import { computed } from 'vue';
import { useStudioStore } from './stores/studio.js';
import { useLayoutStore } from './stores/layout.js';
import Icon from './components/common/Icon.vue';
import AuthScreen from './components/AuthScreen.vue';
import TopBar from './components/TopBar.vue';
import Sidebar from './components/Sidebar.vue';
import WriteView from './components/WriteView.vue';
import HotView from './components/HotView.vue';
import SpeakView from './components/SpeakView.vue';
import MaterialsView from './components/MaterialsView.vue';
import FrameworksView from './components/FrameworksView.vue';
import SelMenu from './components/SelMenu.vue';
import SlashMenu from './components/SlashMenu.vue';
import AssistPop from './components/AssistPop.vue';
import SectionModal from './components/SectionModal.vue';
import QuickstartModal from './components/QuickstartModal.vue';
import JobsModal from './components/JobsModal.vue';
import TitleModal from './components/TitleModal.vue';
import PersonaPage from './components/PersonaPage.vue';
import ProfilePage from './components/ProfilePage.vue';
import PlanModal from './components/PlanModal.vue';
import MetricsModal from './components/MetricsModal.vue';
import InsightsModal from './components/InsightsModal.vue';
import Prompter from './components/Prompter.vue';
import SyncModal from './components/SyncModal.vue';
import InviteModal from './components/InviteModal.vue';
import Toast from './components/common/Toast.vue';
import AskDialog from './components/common/AskDialog.vue';

const s = useStudioStore();
const layout = useLayoutStore();
// 左栏只在创作页收起；热点、口播、素材库照常显示
const sideFolded = computed(() => layout.side && s.view === 'write');
</script>
