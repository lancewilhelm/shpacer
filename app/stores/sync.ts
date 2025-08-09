import { defineStore } from "pinia";
import { ref } from "vue";
import type { SelectGlobalSettings } from "~/utils/db/schema";

export const useSyncStore = defineStore(
  "sync",
  () => {
    const isSyncing = ref(false);
    const lastSyncTime = ref<Date>(new Date(0));
    const syncError = ref<string | null>(null);

    async function doSyncAtLogin() {
      const { session } = useAuth();
      if (!session.value) return;

      isSyncing.value = true;
      syncError.value = null;

      try {
        const body = await getSyncBody("login");
        if (!body) {
          console.error("No data to sync");
          return;
        }
        logger.debug("Sync request body:", body);
        const response = await $fetch<SyncResponse>("/api/sync", {
          method: "POST",
          body,
        });

        if (response.success) {
          // Update synced status for settings
          await updateSyncStatus(body, response);
          await processSyncResponse(response, "login");

          lastSyncTime.value = new Date();
        }
      } catch (err) {
        syncError.value = "Sync failed. Try again.";
        console.error("Login sync error:", err);
      } finally {
        isSyncing.value = false;
      }
    }

    async function sync() {
      const { session } = useAuth();
      if (!session.value) return;

      isSyncing.value = true;
      syncError.value = null;

      try {
        const body = await getSyncBody("full", lastSyncTime.value);
        if (!body) {
          console.error("No data to sync");
          return;
        }

        logger.debug("Sync request body:", body);

        const response = await $fetch<SyncResponse>("/api/sync", {
          method: "POST",
          body,
        });

        if (response.success) {
          // Update synced status for settings
          await updateSyncStatus(body, response);
          await processSyncResponse(response, "full");

          lastSyncTime.value = new Date();
        }
      } catch (err) {
        syncError.value = "Sync failed. Try again.";
        console.error("Full sync error:", err);
      } finally {
        isSyncing.value = false;
      }
    }

    function pull() {
      lastSyncTime.value = new Date(0);
      sync();
    }

    function $reset() {
      isSyncing.value = false;
      lastSyncTime.value = new Date(0);
      syncError.value = null;
    }

    return {
      isSyncing,
      lastSyncTime,
      syncError,
      doSyncAtLogin,
      sync,
      pull,
      $reset,
    };
  },
  {
    persist: true,
  },
);

export type SyncRequest = {
  lastSyncTime: Date | null;
  type: string;
  userSettings: { settings: UserSettings; updatedAt: Date } | null;
  globalSettings: { settings: GlobalSettings; updatedAt: Date } | null;
};

export type SyncResponse = {
  success: boolean;
  data: {
    unsyncedUserSettings: SelectGlobalSettings | null;
    unsyncedGlobalSettings: SelectGlobalSettings | null;
  };
};

async function processSyncResponse(response: SyncResponse, type: string) {
  const { unsyncedUserSettings, unsyncedGlobalSettings } = response.data;

  logger.debug("Processing sync response:", {
    unsyncedUserSettings,
    unsyncedGlobalSettings,
  });

  // --- Process settings ---
  const userSettingsStore = useUserSettingsStore();

  if (unsyncedUserSettings) {
    if (
      new Date(unsyncedUserSettings.updatedAt) >
        new Date(userSettingsStore.updatedAt) ||
      type === "login"
    ) {
      userSettingsStore.updateSettings(
        unsyncedUserSettings.settings as Partial<UserSettings>,
      );
    }
  }

  const globalSettingsStore = useGlobalSettingsStore();
  if (unsyncedGlobalSettings) {
    if (
      new Date(unsyncedGlobalSettings.updatedAt) >
        new Date(globalSettingsStore.updatedAt) ||
      type === "login"
    ) {
      globalSettingsStore.updateSettings(
        unsyncedGlobalSettings.settings as Partial<GlobalSettings>,
      );
    }
  }
}

async function getSyncBody(type: string, lastSyncTime?: Date) {
  if (type === "full" && lastSyncTime) {
    const userSettingsStore = useUserSettingsStore();
    const globalSettingsStore = useGlobalSettingsStore();

    return {
      lastSyncTime: lastSyncTime,
      type: "full",
      userSettings: !userSettingsStore.synced
        ? {
            settings: userSettingsStore.settings,
            updatedAt: userSettingsStore.updatedAt,
          }
        : null,
      globalSettings: !globalSettingsStore.synced
        ? {
            settings: globalSettingsStore.settings,
            updatedAt: globalSettingsStore.updatedAt,
          }
        : null,
    };
  } else if (type === "login") {
    const { user } = useAuth();
    if (!user.value) return null;
    const lastSyncTime = new Date(0);
    return {
      lastSyncTime,
      type: "login",
      userSettings: null,
      globalSettings: null,
    };
  }
}

async function updateSyncStatus(_body: SyncRequest, _response: SyncResponse) {
  const userSettingsStore = useUserSettingsStore();
  const globalSettingsStore = useGlobalSettingsStore();
  userSettingsStore.setSynced(true);
  globalSettingsStore.setSynced(true);
}
