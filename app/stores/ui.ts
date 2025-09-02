import { defineStore } from "pinia";
import {
  clampWaypointPanelWidth,
  clampChartPanelHeight,
} from "~/utils/uiConstants";

export const useUiStore = defineStore(
  "ui",
  () => {
    const commandPaletteVisible = ref(false);
    const waypointPanelWidth = ref(320); // Default width in pixels
    const chartPanelHeightCourse = ref(320); // Default course chart height in pixels
    const chartPanelHeightPlan = ref(320); // Default plan chart height in pixels

    function setCommandPaletteVisible(visible: boolean) {
      commandPaletteVisible.value = visible;
    }

    function setWaypointPanelWidth(width: number) {
      waypointPanelWidth.value = clampWaypointPanelWidth(width);
    }

    function setChartPanelHeightCourse(height: number) {
      chartPanelHeightCourse.value = clampChartPanelHeight(height);
    }

    function setChartPanelHeightPlan(height: number) {
      chartPanelHeightPlan.value = clampChartPanelHeight(height);
    }

    function $reset() {
      commandPaletteVisible.value = false;
      waypointPanelWidth.value = 320;
      chartPanelHeightCourse.value = 320;
      chartPanelHeightPlan.value = 320;
    }

    return {
      commandPaletteVisible,
      waypointPanelWidth,
      chartPanelHeightCourse,
      chartPanelHeightPlan,
      setCommandPaletteVisible,
      setWaypointPanelWidth,
      setChartPanelHeightCourse,
      setChartPanelHeightPlan,
      $reset,
    };
  },
  {
    persist: true,
  },
);
