import { defineStore } from "pinia";
import { triggerDebouncedSync } from "~/utils/sync/debounce";

export const fontFamilyOptions = [
  "Fira Code",
  "Geist",
  "IBM Plex Mono",
  "Inter",
  "Montserrat",
  "Nunito",
  "Poppins",
  "Roboto Mono",
] as const;
export type FontFamily = (typeof fontFamilyOptions)[number];

export const funboxModes = ["confetti", "snow"];
export type FunboxMode = (typeof funboxModes)[number];

export const distanceUnits = ["kilometers", "miles"] as const;
export type DistanceUnit = (typeof distanceUnits)[number];

export const elevationUnits = ["meters", "feet"] as const;
export type ElevationUnit = (typeof elevationUnits)[number];

export interface UserSettings {
  theme?: string;
  fontFamily: FontFamily;
  favoriteThemes: string[];
  themeSorting: {
    sortedByName: boolean;
    reverseSort: boolean;
  };
  funboxModes: FunboxMode[];
  units: {
    distance: DistanceUnit;
    elevation: ElevationUnit;
  };

  smoothing: {
    defaults: {
      gradeWindowMeters: number; // Wg (grade smoothing window)
      sampleStepMeters: number; // Δ (integration sample step)
      paceSmoothingMeters: number; // Wp (pace chart smoothing window)
    };
    perCourse: Record<
      string,
      Partial<{
        gradeWindowMeters: number;
        sampleStepMeters: number;
        paceSmoothingMeters: number;
      }>
    >;
  };
}

function getDefaultSettings(): UserSettings {
  return {
    fontFamily: "Geist",
    favoriteThemes: [],
    themeSorting: {
      sortedByName: false,
      reverseSort: false,
    },
    funboxModes: [],
    units: {
      distance: "kilometers",
      elevation: "meters",
    },

    smoothing: {
      defaults: {
        gradeWindowMeters: 100, // Wg default
        sampleStepMeters: 50, // Δ default
        paceSmoothingMeters: 300, // Wp default
      },
      perCourse: {},
    },
  };
}

export const useUserSettingsStore = defineStore(
  "userSettings",
  () => {
    const settings = ref<UserSettings>(getDefaultSettings());
    function updateSettings(updated: Partial<UserSettings>) {
      if (Object.keys(updated).length === 0) return;

      // Update the settings
      settings.value = { ...settings.value, ...updated };

      // Update sync status
      updatedAt.value = new Date();
      synced.value = false;

      // Trigger sync
      triggerDebouncedSync();
    }

    const updatedAt = ref<Date>(new Date(0));
    const synced = ref(true);
    const setSynced = (value: boolean) => {
      synced.value = value;
    };

    function $reset() {
      settings.value = getDefaultSettings();
      updatedAt.value = new Date(0);
      synced.value = true;
    }

    // Smoothing helpers
    function getSmoothingForCourse(courseId?: string) {
      const d = settings.value.smoothing.defaults;
      if (!courseId) {
        return {
          gradeWindowMeters: d.gradeWindowMeters,
          sampleStepMeters: d.sampleStepMeters,
          paceSmoothingMeters: d.paceSmoothingMeters,
        };
      }
      const override = settings.value.smoothing.perCourse[courseId] || {};
      return {
        gradeWindowMeters: override.gradeWindowMeters ?? d.gradeWindowMeters,
        sampleStepMeters: override.sampleStepMeters ?? d.sampleStepMeters,
        paceSmoothingMeters:
          override.paceSmoothingMeters ?? d.paceSmoothingMeters,
      };
    }

    function updateSmoothingDefaults(
      updated: Partial<{
        gradeWindowMeters: number;
        sampleStepMeters: number;
        paceSmoothingMeters: number;
      }>,
    ) {
      const current = settings.value.smoothing.defaults;
      const newDefaults = { ...current, ...updated };
      settings.value = {
        ...settings.value,
        smoothing: {
          ...settings.value.smoothing,
          defaults: newDefaults,
        },
      };
      updatedAt.value = new Date();
      synced.value = false;
      triggerDebouncedSync();
    }

    function updateCourseSmoothing(
      courseId: string,
      updated: Partial<{
        gradeWindowMeters: number;
        sampleStepMeters: number;
        paceSmoothingMeters: number;
      }>,
    ) {
      if (!courseId) return;
      const current = settings.value.smoothing.perCourse[courseId] || {};
      const perCourse = {
        ...settings.value.smoothing.perCourse,
        [courseId]: { ...current, ...updated },
      };
      settings.value = {
        ...settings.value,
        smoothing: {
          ...settings.value.smoothing,
          perCourse,
        },
      };
      updatedAt.value = new Date();
      synced.value = false;
      triggerDebouncedSync();
    }

    function clearCourseSmoothing(courseId: string) {
      if (!courseId) return;
      const perCourse = Object.fromEntries(
        Object.entries(settings.value.smoothing.perCourse).filter(
          ([key]) => key !== courseId,
        ),
      ) as Record<
        string,
        Partial<{
          gradeWindowMeters: number;
          sampleStepMeters: number;
          paceSmoothingMeters: number;
        }>
      >;
      settings.value = {
        ...settings.value,
        smoothing: {
          ...settings.value.smoothing,
          perCourse,
        },
      };
      updatedAt.value = new Date();
      synced.value = false;
      triggerDebouncedSync();
    }

    return {
      settings,
      updatedAt,
      updateSettings,
      synced,
      setSynced,
      $reset,
      // smoothing helpers
      getSmoothingForCourse,
      updateSmoothingDefaults,
      updateCourseSmoothing,
      clearCourseSmoothing,
    };
  },
  {
    persist: true,
  },
);
