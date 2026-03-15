import { and, asc, eq, inArray } from "drizzle-orm";
import { auth } from "~/utils/auth";
import {
  courseActivities,
  courses,
  plans,
  userCourses,
  waypoints,
  waypointStoppageTimes,
} from "~/utils/db/schema";
import { buildPlanComparisonSummary } from "~~/server/utils/courseActivities";
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

  const gradeWindowMeters = Number.parseInt(
    getQuery(event).gradeWindowMeters as string,
    10,
  );
  const sampleStepMeters = Number.parseInt(
    getQuery(event).sampleStepMeters as string,
    10,
  );

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

  const [activity] = await cloudDb
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

  if (!activity) {
    throw createError({
      statusCode: 404,
      statusMessage: "Activity not found",
    });
  }

  const [course] = await cloudDb
    .select({
      geoJsonData: courses.geoJsonData,
    })
    .from(courses)
    .where(eq(courses.id, courseId))
    .limit(1);

  if (!course) {
    throw createError({
      statusCode: 404,
      statusMessage: "Course not found",
    });
  }

  const coursePlans = await cloudDb
    .select()
    .from(plans)
    .where(and(eq(plans.courseId, courseId), eq(plans.userId, session.user.id)))
    .orderBy(asc(plans.createdAt));
  const courseWaypoints = await cloudDb
    .select()
    .from(waypoints)
    .where(eq(waypoints.courseId, courseId))
    .orderBy(waypoints.order);

  const stoppages = coursePlans.length
    ? await cloudDb
        .select()
        .from(waypointStoppageTimes)
        .where(
          inArray(
            waypointStoppageTimes.planId,
            coursePlans.map((plan) => plan.id),
          ),
        )
    : [];

  const summaries = coursePlans
    .map((plan) =>
      buildPlanComparisonSummary({
        activity,
        plan,
        courseGeoJson: course.geoJsonData as GeoJSON.FeatureCollection,
        waypoints: courseWaypoints,
        waypointStoppageTimes: stoppages.filter(
          (stoppage) => stoppage.planId === plan.id,
        ),
        gradeWindowMeters: Number.isFinite(gradeWindowMeters)
          ? gradeWindowMeters
          : undefined,
        sampleStepMeters: Number.isFinite(sampleStepMeters)
          ? sampleStepMeters
          : undefined,
      }),
    )
    .sort((a, b) => {
      if (a.closestFitScore === null && b.closestFitScore === null) return 0;
      if (a.closestFitScore === null) return 1;
      if (b.closestFitScore === null) return -1;
      return a.closestFitScore - b.closestFitScore;
    });

  return {
    activityId: activity.id,
    summaries,
  };
});
