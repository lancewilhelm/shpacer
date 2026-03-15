import { and, eq } from "drizzle-orm";
import { auth } from "~/utils/auth";
import {
  courseActivities,
  courses,
  plans,
  userCourses,
  waypoints,
  waypointStoppageTimes,
} from "~/utils/db/schema";
import { buildPlanComparisonDetail } from "~~/server/utils/courseActivities";
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
  const query = getQuery(event);
  const planId = typeof query.planId === "string" ? query.planId : null;
  const distanceUnit =
    query.distanceUnit === "kilometers" ? "kilometers" : "miles";
  const gradeWindowMeters = Number.parseInt(query.gradeWindowMeters as string, 10);
  const sampleStepMeters = Number.parseInt(query.sampleStepMeters as string, 10);

  if (!courseId || !activityId || !planId) {
    throw createError({
      statusCode: 400,
      statusMessage: "Course ID, activity ID, and planId are required",
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

  const [plan] = await cloudDb
    .select()
    .from(plans)
    .where(
      and(
        eq(plans.id, planId),
        eq(plans.courseId, courseId),
        eq(plans.userId, session.user.id),
      ),
    )
    .limit(1);

  if (!plan) {
    throw createError({
      statusCode: 404,
      statusMessage: "Plan not found",
    });
  }

  const [course] = await cloudDb
    .select({
      geoJsonData: courses.geoJsonData,
    })
    .from(courses)
    .where(eq(courses.id, courseId))
    .limit(1);
  const courseWaypoints = await cloudDb
    .select()
    .from(waypoints)
    .where(eq(waypoints.courseId, courseId))
    .orderBy(waypoints.order);
  const stoppages = await cloudDb
    .select()
    .from(waypointStoppageTimes)
    .where(eq(waypointStoppageTimes.planId, planId));

  if (!course) {
    throw createError({
      statusCode: 404,
      statusMessage: "Course not found",
    });
  }

  return {
    detail: buildPlanComparisonDetail({
      activity,
      plan,
      courseGeoJson: course.geoJsonData as GeoJSON.FeatureCollection,
      waypoints: courseWaypoints,
      waypointStoppageTimes: stoppages,
      distanceUnit,
      gradeWindowMeters: Number.isFinite(gradeWindowMeters)
        ? gradeWindowMeters
        : undefined,
      sampleStepMeters: Number.isFinite(sampleStepMeters)
        ? sampleStepMeters
        : undefined,
    }),
  };
});
