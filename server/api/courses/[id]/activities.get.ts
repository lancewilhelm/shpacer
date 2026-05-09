import { and, desc, eq } from "drizzle-orm";
import { auth } from "~/utils/auth";
import { extractElevationProfile } from "~/utils/elevationProfile";
import { courseActivities, courses, userCourses } from "~/utils/db/schema";
import {
  getCourseActivityMatchData,
  type CourseActivitiesResponse,
} from "~/utils/courseActivities";
import {
  getMatchConfidence,
  getMatchStatusFromData,
  hasImplausibleProgressJump,
  matchActivityToCourse,
  parseActivityFile,
} from "~~/server/utils/courseActivities";
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

  const courseRows = await cloudDb
    .select({
      id: courses.id,
      geoJsonData: courses.geoJsonData,
      totalDistance: courses.totalDistance,
    })
    .from(courses)
    .where(eq(courses.id, courseId))
    .limit(1);
  const course = courseRows[0];

  if (!course) {
    throw createError({
      statusCode: 404,
      statusMessage: "Course not found",
    });
  }

  const courseDistanceMeters =
    course.totalDistance ??
    (() => {
      const elevationProfile = extractElevationProfile(
        course.geoJsonData as GeoJSON.FeatureCollection,
      );
      return elevationProfile[elevationProfile.length - 1]?.distance || 0;
    })();

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

  const repairedActivities = [];
  for (const activity of activities) {
    const matchData = getCourseActivityMatchData(activity);
    if (!hasImplausibleProgressJump(matchData)) {
      repairedActivities.push(activity);
      continue;
    }

    const parsed = parseActivityFile({
      sourceFileName: activity.sourceFileName,
      originalFileContent: activity.originalFileContent,
      fileType: activity.fileType as "gpx" | "tcx",
    });
    const repairedMatchData = matchActivityToCourse({
      courseGeoJson: course.geoJsonData as GeoJSON.FeatureCollection,
      points: parsed.points,
      courseDistanceMeters,
    });
    const repairedMatchStatus = getMatchStatusFromData(repairedMatchData);
    const repairedMatchConfidence = getMatchConfidence(repairedMatchData);

    const updated = await cloudDb
      .update(courseActivities)
      .set({
        provider: parsed.provider,
        geoJsonData: parsed.geoJsonData,
        startedAt: parsed.startedAt,
        endedAt: parsed.endedAt,
        elapsedTimeSeconds: parsed.elapsedTimeSeconds,
        recordedDistanceMeters: parsed.recordedDistanceMeters,
        matchedDistanceMeters:
          repairedMatchData.samples[repairedMatchData.samples.length - 1]
            ?.distanceMeters || 0,
        matchStatus: repairedMatchStatus,
        matchConfidence: repairedMatchConfidence,
        matchData: repairedMatchData,
        updatedAt: new Date(),
      })
      .where(eq(courseActivities.id, activity.id))
      .returning();

    repairedActivities.push(updated[0] ?? activity);
  }

  const response: CourseActivitiesResponse = {
    activities: repairedActivities,
    primaryActivityId:
      repairedActivities.find((activity) => activity.isPrimary)?.id || null,
  };

  return response;
});
