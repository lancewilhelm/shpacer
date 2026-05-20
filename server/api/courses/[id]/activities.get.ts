import { and, desc, eq } from "drizzle-orm"
import { auth } from "~/utils/auth"
import { courseActivities, userCourses } from "~/utils/db/schema"
import type {
  CourseActivitiesResponse,
  CourseActivitySummary,
} from "~/utils/courseActivities"
import { cloudDb } from "~~/server/utils/db/cloud"

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({
    headers: event.headers,
  })

  if (!session?.user?.id) {
    throw createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
    })
  }

  const courseId = getRouterParam(event, "id")
  if (!courseId) {
    throw createError({
      statusCode: 400,
      statusMessage: "Course ID is required",
    })
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
    .limit(1)

  if (membership.length === 0) {
    throw createError({
      statusCode: 404,
      statusMessage: "Course not found",
    })
  }

  const activityRows = await cloudDb
    .select({
      id: courseActivities.id,
      sourceFileName: courseActivities.sourceFileName,
      provider: courseActivities.provider,
      startedAt: courseActivities.startedAt,
      endedAt: courseActivities.endedAt,
      elapsedTimeSeconds: courseActivities.elapsedTimeSeconds,
      recordedDistanceMeters: courseActivities.recordedDistanceMeters,
      matchedDistanceMeters: courseActivities.matchedDistanceMeters,
      matchStatus: courseActivities.matchStatus,
      matchConfidence: courseActivities.matchConfidence,
      isPrimary: courseActivities.isPrimary,
      createdAt: courseActivities.createdAt,
      updatedAt: courseActivities.updatedAt,
    })
    .from(courseActivities)
    .where(
      and(
        eq(courseActivities.courseId, courseId),
        eq(courseActivities.userId, session.user.id),
      ),
    )
    .orderBy(desc(courseActivities.createdAt))

  const activities: CourseActivitySummary[] = activityRows.map((activity) => ({
    ...activity,
    provider: activity.provider as CourseActivitySummary["provider"],
    matchStatus: activity.matchStatus as CourseActivitySummary["matchStatus"],
  }))

  const response: CourseActivitiesResponse = {
    activities,
  }

  return response
})
