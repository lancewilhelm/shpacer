import { cloudDb } from "~~/server/utils/db/cloud";
import { logger } from "~/utils/logger";
import { userSettings, globalSettings } from "~/utils/db/schema";
import { type InferSelectModel, sql, and, eq, gt } from "drizzle-orm";
import { auth } from "~/utils/auth";
import type { SyncRequest } from "~/stores/sync";

export function coerceDate(value: unknown): Date {
  if (value instanceof Date) return value;
  if (typeof value === "number" || typeof value === "string")
    return new Date(value);
  return new Date();
}

export default defineEventHandler(async (event) => {
  logger.debug("POST /api/sync");
  // Ensure the user is authenticated
  const session = await auth.api.getSession({
    headers: event.headers,
  });

  if (!session) {
    logger.error("POST /api/sync: Unauthorized access attempt");
    setResponseStatus(event, 401);
    return {
      message: "Unauthorized",
    };
  }

  const user = session.user;

  const body = await readBody<SyncRequest>(event);
  logger.debug(body, "POST /api/sync: Request body");

  try {
    // If this is a full sync then insert the unsynced data into the cloud database
    if (body.type === "full") {
      // Insert user settings
      if (body.userSettings) {
        await cloudDb
          .insert(userSettings)
          .values({
            userId: user.id,
            settings: body.userSettings.settings,
            updatedAt: new Date(body.userSettings.updatedAt),
          })
          .onConflictDoUpdate({
            target: userSettings.userId,
            set: {
              settings: sql`EXCLUDED.settings`,
              updatedAt: sql`EXCLUDED.updated_at`,
            },
          });
      }

      // Insert global settings (admin-only)
      if (
        body.globalSettings &&
        (user.role === "admin" || user.role === "owner")
      ) {
        const GLOBAL_SETTINGS_ID = "00000000-0000-0000-0000-000000000000";
        await cloudDb
          .insert(globalSettings)
          .values({
            id: GLOBAL_SETTINGS_ID,
            settings: body.globalSettings.settings,
            updatedAt: new Date(body.globalSettings.updatedAt),
          })
          .onConflictDoUpdate({
            target: globalSettings.id,
            set: {
              settings: sql`EXCLUDED.settings`,
              updatedAt: sql`EXCLUDED.updated_at`,
            },
          });
      }
      logger.debug("POST /api/sync: Insert successful");
    }

    // Select all the unsynced data from the cloud database
    const since = coerceDate(body.lastSyncTime);
    // Select user settings
    const unsyncedUserSettingsRes = (await cloudDb
      .select()
      .from(userSettings)
      .where(
        and(
          eq(userSettings.userId, user.id),
          gt(
            userSettings.updatedAt,
            body.type === "login" ? new Date(0) : since,
          ),
        ),
      )) as InferSelectModel<typeof userSettings>[];

    // Select global settings
    const GLOBAL_SETTINGS_ID = "00000000-0000-0000-0000-000000000000";
    const unsyncedGlobalSettingsRes = (await cloudDb
      .select()
      .from(globalSettings)
      .where(
        and(
          eq(globalSettings.id, GLOBAL_SETTINGS_ID),
          gt(
            globalSettings.updatedAt,
            body.type === "login" ? new Date(0) : since,
          ),
        ),
      )) as InferSelectModel<typeof globalSettings>[];

    logger.debug("POST /api/sync: Select successful");

    const data = {
      unsyncedUserSettings: unsyncedUserSettingsRes.length
        ? unsyncedUserSettingsRes[0]
        : null,
      unsyncedGlobalSettings: unsyncedGlobalSettingsRes.length
        ? unsyncedGlobalSettingsRes[0]
        : null,
    };

    logger.debug(data, "POST /api/sync: Response data");
    return { success: true, data };
  } catch (error) {
    logger.error(error, "POST /api/sync: Error during sync");
    setResponseStatus(event, 500);
    return {
      success: false,
      message: "Sync failed",
    };
  }
});
