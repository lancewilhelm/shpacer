import { eq } from "drizzle-orm";
import { getRequestURL, setResponseStatus } from "h3";
import { auth } from "~/utils/auth";
import { cloudDb } from "~~/server/utils/db/cloud";
import { users } from "~/utils/db/schema";
import { logger } from "~/utils/logger";

/**
 * PATCH /api/users/reset-password
 *
 * Allows an admin or owner to reset a user's password to the fixed value "password".
 *
 * Protections:
 * - Callers must be authenticated.
 * - Caller must be role 'admin' or 'owner'.
 * - Admins cannot reset passwords for other admins or owners.
 * - Only owners can reset owner passwords.
 *
 * Implementation detail:
 * We attempt to use Better Auth's admin update user endpoints (paths can differ by version).
 * If none are available we return a 500 error.
 */
export default defineEventHandler(async (event) => {
  logger.debug("PATCH /api/users/reset-password");

  // Auth session
  const session = await auth.api.getSession({ headers: event.headers });
  if (!session) {
    setResponseStatus(event, 401);
    return { message: "Unauthorized" };
  }

  const actorRole = session.user.role;
  if (actorRole !== "admin" && actorRole !== "owner") {
    setResponseStatus(event, 403);
    return { message: "Forbidden" };
  }

  // Parse and validate body (manual validation to avoid zod dependency)
  const body = await readBody(event).catch(() => null);
  let userId: string | null = null;
  if (
    body &&
    typeof body === "object" &&
    "userId" in body &&
    typeof (body as { userId?: unknown }).userId === "string" &&
    (body as { userId: string }).userId.trim().length > 0
  ) {
    userId = (body as { userId: string }).userId.trim();
  } else {
    setResponseStatus(event, 400);
    return { message: "Invalid request body" };
  }

  // Fetch target user's role
  const targetUser = await cloudDb
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId!))
    .limit(1);

  if (!targetUser.length) {
    setResponseStatus(event, 404);
    return { message: "User not found" };
  }

  const targetRole = targetUser[0].role;

  // Admins cannot reset passwords for admins/owners
  if (
    actorRole === "admin" &&
    (targetRole === "admin" || targetRole === "owner")
  ) {
    setResponseStatus(event, 403);
    return { message: "Cannot reset password for admin or owner accounts" };
  }

  // Only owners can reset owner passwords
  if (targetRole === "owner" && actorRole !== "owner") {
    setResponseStatus(event, 403);
    return { message: "Only owners can reset owner passwords" };
  }

  const origin = getRequestURL(event).origin;
  const fixedPassword = "password";

  // Candidate Better Auth admin endpoints (version-dependent)
  const candidatePaths = [
    "/api/auth/admin/update-user",
    "/api/auth/admin/users/update",
  ];

  let success = false;
  let lastError: unknown = null;

  const getStatusFromError = (e: unknown): number | undefined => {
    if (typeof e !== "object" || e === null) return undefined;
    const resp = (e as { response?: { status?: unknown } }).response;
    if (resp && typeof resp.status === "number") return resp.status;
    const s = (e as { status?: unknown }).status;
    return typeof s === "number" ? s : undefined;
  };

  for (const path of candidatePaths) {
    try {
      await $fetch(path, {
        baseURL: origin,
        method: "PATCH",
        headers: Object.fromEntries(new Headers(event.headers).entries()),
        body: {
          userId,
          password: fixedPassword,
        },
      });
      success = true;
      break;
    } catch (err) {
      lastError = err;
      const status = getStatusFromError(err);
      // If endpoint truly missing, try next candidate; otherwise abort loop
      if (status !== 404) break;
    }
  }

  if (!success) {
    logger.error(
      lastError,
      "PATCH /api/users/reset-password: Failed to reset password via admin endpoint(s)",
    );
    setResponseStatus(event, 500);
    return { message: "Failed to reset password" };
  }

  logger.info(
    `Admin ${session.user.email} reset password for user ${userId} to fixed value`,
  );
  return { success: true };
});
