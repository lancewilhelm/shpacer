import { and, desc, eq } from "drizzle-orm";
import { auth } from "~/utils/auth";
import { courseActivities, userCourses } from "~/utils/db/schema";
import type { CourseActivitiesResponse } from "~/utils/courseActivities";
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
  if (!courseId) {
    throw createError({
      statusCode: 400,
      statusMessage: "Course ID is required",
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

  const activities = await cloudDb
    .select()
    .from(courseActivities)
    .where(
      and(
        eq(courseActivities.courseId, courseId),
        eq(courseActivities.userId, session.user.id),
      ),
    )
    .orderBy(desc(courseActivities.createdAt));

  const response: CourseActivitiesResponse = {
    activities,
    primaryActivityId:
      activities.find((activity) => activity.isPrimary)?.id || null,
  };

  return response;
});
