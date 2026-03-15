import { and, eq } from "drizzle-orm";
import { auth } from "~/utils/auth";
import { courseActivities, userCourses } from "~/utils/db/schema";
import { cloudDb } from "~~/server/utils/db/cloud";

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
  const activityId = getRouterParam(event, "activityId");
  if (!courseId || !activityId) {
    throw createError({
      statusCode: 400,
      statusMessage: "Course ID and activity ID are required",
    });
  }

  const membership = await cloudDb
    .select({ courseId: userCourses.courseId })
    .from(userCourses)
    .where(
      and(
        eq(userCourses.courseId, courseId),
        eq(userCourses.userId, session.user.id),
      ),
    )
    .limit(1);

  if (membership.length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Course not found",
    });
  }

  const existing = await cloudDb
    .select()
    .from(courseActivities)
    .where(
      and(
        eq(courseActivities.id, activityId),
        eq(courseActivities.courseId, courseId),
        eq(courseActivities.userId, session.user.id),
      ),
    )
    .limit(1);

  if (existing.length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Activity not found",
    });
  }

  await cloudDb.delete(courseActivities).where(eq(courseActivities.id, activityId));

  return {
    ok: true,
  };
});
