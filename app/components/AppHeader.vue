<script setup lang="ts">
const uiStore = useUiStore();
</script>

<template>
  <div
    class="flex justify-between items-center gap-4 px-4 py-2 border-b border-(--sub-color) bg-(--bg-color) shrink-0 app-header"
  >
    <div class="flex items-center gap-4 app-header-left">
      <PageNavigation />
    </div>
    <div class="flex gap-4 items-center justify-self-end app-header-right">
      <Icon
        name="lucide:command"
        class="text-(--main-color) cursor-pointer scale-125 header-icon"
        @click="
          uiStore.setCommandPaletteVisible(!uiStore.commandPaletteVisible)
        "
      />
    </div>
  </div>
</template>
