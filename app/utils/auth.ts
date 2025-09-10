import { betterAuth } from "better-auth";
import { admin as baAdmin } from "better-auth/plugins";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { cloudDb } from "~~/server/utils/db/cloud";
import * as schema from "./db/schema";
import { count } from "drizzle-orm";
import { ac, user, admin, owner } from "./permissions";
import type { GlobalSettings } from "~/stores/globalSettings";

export const auth = betterAuth({
  baseURL: getBaseURL(),
  trustedOrigins: getTrustedOrigins(),
  advanced: {
    cookiePrefix: "shpacer",
  },
  plugins: [
    baAdmin({
      ac,
      roles: {
        user,
        admin,
        owner,
      },
    }),
  ],
  database: drizzleAdapter(cloudDb, {
    provider: "sqlite",
    schema: {
      ...schema,
    },
    usePlural: true,
  }),
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: true,
        defaultValue: "user",
        input: false,
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 6,
    autoSignIn: true,
  },
  databaseHooks: {
    user: {
      create: {
        before: async (user) => {
          // Determine if this is the first user
          const userCount = await cloudDb
            .select({ count: count() })
            .from(schema.users);
          const isFirstUser = !userCount[0] || userCount[0].count === 0;

          // Determine whether creation is coming from admin endpoints (avoid circular auth reference)
          let isAdminCreator = false;
          try {
            const event = useEvent();
            const pathname = getRequestURL(event).pathname;
            isAdminCreator =
              typeof pathname === "string" &&
              pathname.includes("/api/auth/admin");
          } catch (error) {
            console.log("Failed to determine request context", error);
            // no-op: assume not admin if request context cannot be determined
          }

          // Only enforce registration toggle for non-admin creators and non-first user
          if (!isAdminCreator && !isFirstUser) {
            const response = await cloudDb.select().from(schema.globalSettings);
            const settings = response[0]?.settings as GlobalSettings;
            const allowRegistration =
              settings === undefined || settings.allowRegistration;

            if (!allowRegistration) {
              throw new APIError("UNAUTHORIZED", {
                message: "Registration is closed.",
              });
            }
          }

          // Determine final role:
          // - first user is always 'owner'
          // - admin-created users honor requested role except 'owner'
          // - self-registrations are always 'user'
          let finalRole: "owner" | "admin" | "user";
          if (isFirstUser) {
            finalRole = "owner";
          } else if (isAdminCreator) {
            const maybeRole = (user as { role?: unknown }).role;
            const requestedRole =
              typeof maybeRole === "string" &&
              (maybeRole === "admin" || maybeRole === "user")
                ? (maybeRole as "admin" | "user")
                : "user";
            finalRole = requestedRole;
          } else {
            finalRole = "user";
          }

          return {
            data: {
              ...user,
              role: finalRole,
            },
          };
        },
      },
    },
  },
});

function getBaseURL() {
  let baseURL = process.env.BETTER_AUTH_URL;
  if (!baseURL) {
    try {
      baseURL = getRequestURL(useEvent()).origin;
    } catch {
      //pass
    }
  }
  return baseURL;
}

function getTrustedOrigins() {
  const origins = process.env.BETTER_AUTH_TRUSTED_ORIGINS;
  if (!origins) return [];
  return origins.split(",").map((origin) => origin.trim());
}

export async function requireUser(event: { headers: Headers }) {
  const session = await auth.api.getSession({
    headers: event.headers,
  });

  if (!session) {
    throw createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
    });
  }

  return session.user;
}

export async function requireAdmin(event: { headers: Headers }) {
  const session = await auth.api.getSession({
    headers: event.headers,
  });

  if (!session) {
    throw createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
    });
  }

  if (session.user.role !== "admin" && session.user.role !== "owner") {
    throw createError({
      statusCode: 403,
      statusMessage: "Forbidden: Admin access required",
    });
  }

  return session.user;
}
