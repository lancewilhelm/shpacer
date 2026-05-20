import { and, eq } from "drizzle-orm"
import { auth } from "~/utils/auth"
import type { CourseActivityDetailResponse } from "~/utils/courseActivities"
import { userCourses } from "~/utils/db/schema"
import { loadCourseActivityDetail } from "~~/server/utils/courseActivityDetail"
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
  const activityId = getRouterParam(event, "activityId")
  if (!courseId || !activityId) {
    throw createError({
      statusCode: 400,
      statusMessage: "Course ID and activity ID are required",
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

  const activity = await loadCourseActivityDetail({
    courseId,
    activityId,
    userId: session.user.id,
  })

  if (!activity) {
    throw createError({
      statusCode: 404,
      statusMessage: "Activity not found",
    })
  }

  const response: CourseActivityDetailResponse = {
    activity,
  }

  return response
})
