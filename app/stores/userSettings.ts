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

export const distanceUnits = ["follow_course", "kilometers", "miles"] as const;
export type DistanceUnitSetting = (typeof distanceUnits)[number];
export type DistanceUnit = Exclude<DistanceUnitSetting, "follow_course">;

export const elevationUnits = ["follow_course", "meters", "feet"] as const;
export type ElevationUnitSetting = (typeof elevationUnits)[number];
export type ElevationUnit = Exclude<ElevationUnitSetting, "follow_course">;
export type UnitStrategy = "follow_course" | "override";

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
    distance: DistanceUnitSetting;
    elevation: ElevationUnitSetting;
    strategy?: UnitStrategy;
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
      strategy: "override",
      distance: "follow_course",
      elevation: "follow_course",
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

    // Unit helpers
    function resolveUnitsForCourse(
      course?: Partial<{
        defaultDistanceUnit: DistanceUnit;
        defaultElevationUnit: ElevationUnit;
      }>,
    ) {
      const u = settings.value.units;
      const distance: DistanceUnit = (
        u.distance === "follow_course"
          ? (course?.defaultDistanceUnit ?? "miles")
          : u.distance
      ) as DistanceUnit;
      const elevation: ElevationUnit = (
        u.elevation === "follow_course"
          ? (course?.defaultElevationUnit ?? "feet")
          : u.elevation
      ) as ElevationUnit;
      return { distance, elevation };
    }

    function getDistanceUnitForCourse(
      course?: Partial<{ defaultDistanceUnit: DistanceUnit }>,
    ) {
      return resolveUnitsForCourse(course).distance;
    }

    function getElevationUnitForCourse(
      course?: Partial<{ defaultElevationUnit: ElevationUnit }>,
    ) {
      return resolveUnitsForCourse(course).elevation;
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
      // unit helpers
      resolveUnitsForCourse,
      getDistanceUnitForCourse,
      getElevationUnitForCourse,
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
