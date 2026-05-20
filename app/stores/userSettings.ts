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

export const funboxModes = ["confetti", "snow"] as const;
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
  chartStyle: {
    showAreaGradient: boolean;
    invertPaceYAxis: boolean;
  };
  units: {
    distance: DistanceUnitSetting;
    elevation: ElevationUnitSetting;
    strategy?: UnitStrategy;
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
    chartStyle: {
      showAreaGradient: true,
      invertPaceYAxis: true,
    },
    units: {
      strategy: "override",
      distance: "follow_course",
      elevation: "follow_course",
    },
  };
}

function normalizeUserSettings(
  input?: Partial<UserSettings> | null,
): UserSettings {
  const defaults = getDefaultSettings();
  const settings = input ?? {};

  return {
    theme: settings.theme,
    fontFamily: settings.fontFamily ?? defaults.fontFamily,
    favoriteThemes: Array.isArray(settings.favoriteThemes)
      ? settings.favoriteThemes
      : defaults.favoriteThemes,
    themeSorting: {
      ...defaults.themeSorting,
      ...(settings.themeSorting ?? {}),
    },
    funboxModes: Array.isArray(settings.funboxModes)
      ? settings.funboxModes
      : defaults.funboxModes,
    chartStyle: {
      ...defaults.chartStyle,
      ...(settings.chartStyle ?? {}),
    },
    units: {
      ...defaults.units,
      ...(settings.units ?? {}),
    },
  };
}

function mergeUserSettings(
  base: UserSettings,
  updated: Partial<UserSettings>,
): UserSettings {
  return normalizeUserSettings({
    ...base,
    ...updated,
    themeSorting: {
      ...(base.themeSorting ?? {}),
      ...(updated.themeSorting ?? {}),
    },
    chartStyle: {
      ...(base.chartStyle ?? {}),
      ...(updated.chartStyle ?? {}),
    },
    units: {
      ...(base.units ?? {}),
      ...(updated.units ?? {}),
    },
  });
}

export const useUserSettingsStore = defineStore(
  "userSettings",
  () => {
    const settings = ref<UserSettings>(normalizeUserSettings());

    watch(
      settings,
      (value) => {
        const normalized = normalizeUserSettings(value);
        const currentJson = JSON.stringify(value);
        const normalizedJson = JSON.stringify(normalized);
        if (currentJson !== normalizedJson) {
          settings.value = normalized;
        }
      },
      { immediate: true, deep: true },
    );

    function updateSettings(updated: Partial<UserSettings>) {
      if (Object.keys(updated).length === 0) return;

      settings.value = mergeUserSettings(settings.value, updated);
      updatedAt.value = new Date();
      synced.value = false;
      triggerDebouncedSync();
    }

    function applyRemoteSettings(
      updated: Partial<UserSettings>,
      remoteUpdatedAt?: Date | string | number | null,
    ) {
      if (Object.keys(updated).length === 0) return;

      settings.value = mergeUserSettings(settings.value, updated);
      updatedAt.value = remoteUpdatedAt ? new Date(remoteUpdatedAt) : new Date();
      synced.value = true;
    }

    const updatedAt = ref<Date>(new Date(0));
    const synced = ref(true);
    const setSynced = (value: boolean) => {
      synced.value = value;
    };

    function $reset() {
      settings.value = normalizeUserSettings();
      updatedAt.value = new Date(0);
      synced.value = true;
    }

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

    return {
      settings,
      updatedAt,
      updateSettings,
      applyRemoteSettings,
      synced,
      setSynced,
      $reset,
      resolveUnitsForCourse,
      getDistanceUnitForCourse,
      getElevationUnitForCourse,
    };
  },
  {
    persist: [
      {
        storage: piniaPluginPersistedstate.cookies(),
        pick: [
          "settings.theme",
          "settings.fontFamily",
          "settings.favoriteThemes",
          "settings.themeSorting",
          "settings.funboxModes",
          "settings.chartStyle",
          "settings.units",
        ],
      },
      {
        storage: piniaPluginPersistedstate.localStorage(),
        pick: ["settings", "updatedAt", "synced"],
      },
    ],
  },
);
