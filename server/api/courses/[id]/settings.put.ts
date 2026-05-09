import { and, eq } from "drizzle-orm";
import { auth } from "~/utils/auth";
import {
  userCourseSettings,
  userCourses,
} from "~/utils/db/schema";
import { normalizeCourseAnalysisSettings } from "~/utils/courseSettings";
import { cloudDb } from "~~/server/utils/db/cloud";

interface UpdateCourseSettingsRequest {
  settings: Record<string, unknown> | null;
}

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({
    headers: event.headers,
  });

  if (!session?.user?.id) {
    throw createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
    });
  }

  const courseId = getRouterParam(event, "id");
  if (!courseId) {
    throw createError({
      statusCode: 400,
      statusMessage: "Course ID is required",
    });
  }

  const [membership] = await cloudDb
    .select({ role: userCourses.role })
    .from(userCourses)
    .where(
      and(
        eq(userCourses.courseId, courseId),
        eq(userCourses.userId, session.user.id),
      ),
    )
    .limit(1);

  if (!membership) {
    throw createError({
      statusCode: 404,
      statusMessage: "Course not found or access denied",
    });
  }

  if (membership.role !== "owner") {
    throw createError({
      statusCode: 403,
      statusMessage: "Only the owner can modify course settings",
    });
  }

  const body = await readBody<UpdateCourseSettingsRequest>(event);

  if (body.settings === null) {
    await cloudDb
      .delete(userCourseSettings)
      .where(
        and(
          eq(userCourseSettings.courseId, courseId),
          eq(userCourseSettings.userId, session.user.id),
        ),
      );

    return {
      success: true,
      settings: normalizeCourseAnalysisSettings(),
    };
  }

  const normalizedSettings = normalizeCourseAnalysisSettings(body.settings);

  await cloudDb
    .insert(userCourseSettings)
    .values({
      userId: session.user.id,
      courseId,
      settings: normalizedSettings,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [userCourseSettings.userId, userCourseSettings.courseId],
      set: {
        settings: normalizedSettings,
        updatedAt: new Date(),
      },
    });

  return {
    success: true,
    settings: normalizedSettings,
  };
});
