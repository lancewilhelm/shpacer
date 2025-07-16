import { defineStore } from "pinia";

export const useUiStore = defineStore(
  "ui",
  () => {
    const commandPaletteVisible = ref(false);
    const waypointPanelWidth = ref(320); // Default width in pixels
    
    function setCommandPaletteVisible(visible: boolean) {
      commandPaletteVisible.value = visible;
    }

    function setWaypointPanelWidth(width: number) {
      waypointPanelWidth.value = Math.max(240, Math.min(1000, width)); // Min 240px, Max 600px
    }

    function $reset() {
      commandPaletteVisible.value = false;
      waypointPanelWidth.value = 320;
    }

    return {
      commandPaletteVisible,
      waypointPanelWidth,
      setCommandPaletteVisible,
      setWaypointPanelWidth,
      $reset,
    };
  },
  {
    persist: true,
  },
);
