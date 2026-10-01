<template>
  <AuthScreen />

  <div id="app" class="app" :class="{ hidden: !s.user }">
    <TopBar />
    <div class="layout">
      <Sidebar />
      <!-- 宽度按步骤走，见 .main[data-step] -->
      <main class="main" id="main" :data-step="s.view === 'write' ? s.step : undefined" :data-view="s.view">
        <WriteView />
        <HotView />
        <SpeakView />
        <MaterialsView />
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
  <FrameworkModal />
  <PersonaPage />
  <PlanModal />
  <MetricsModal />
  <InsightsModal />
  <Prompter />

  <Toast />
  <AskDialog />
</template>

<script setup>
import { useStudioStore } from './stores/studio.js';
import AuthScreen from './components/AuthScreen.vue';
import TopBar from './components/TopBar.vue';
import Sidebar from './components/Sidebar.vue';
import WriteView from './components/WriteView.vue';
import HotView from './components/HotView.vue';
import SpeakView from './components/SpeakView.vue';
import MaterialsView from './components/MaterialsView.vue';
import SelMenu from './components/SelMenu.vue';
import SlashMenu from './components/SlashMenu.vue';
import AssistPop from './components/AssistPop.vue';
import SectionModal from './components/SectionModal.vue';
import QuickstartModal from './components/QuickstartModal.vue';
import JobsModal from './components/JobsModal.vue';
import TitleModal from './components/TitleModal.vue';
import FrameworkModal from './components/FrameworkModal.vue';
import PersonaPage from './components/PersonaPage.vue';
import PlanModal from './components/PlanModal.vue';
import MetricsModal from './components/MetricsModal.vue';
import InsightsModal from './components/InsightsModal.vue';
import Prompter from './components/Prompter.vue';
import Toast from './components/common/Toast.vue';
import AskDialog from './components/common/AskDialog.vue';

const s = useStudioStore();
</script>
