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

    return {
      settings,
      updatedAt,
      updateSettings,
      synced,
      setSynced,
      $reset,
    };
  },
  {
    persist: true,
  },
);
