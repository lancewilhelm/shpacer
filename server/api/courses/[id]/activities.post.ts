import { and, eq } from "drizzle-orm";
import { auth } from "~/utils/auth";
import { extractElevationProfile } from "~/utils/elevationProfile";
import { courseActivities, courses, userCourses } from "~/utils/db/schema";
import {
  getMatchConfidence,
  getMatchStatusFromData,
  matchActivityToCourse,
  parseActivityFile,
} from "~~/server/utils/courseActivities";
import { cloudDb } from "~~/server/utils/db/cloud";

interface CreateActivityRequest {
  sourceFileName: string;
  originalFileContent: string;
  fileType: "gpx" | "tcx";
  isPrimary?: boolean;
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

  const body = await readBody<CreateActivityRequest>(event);
  if (
    !body?.sourceFileName ||
    !body?.originalFileContent ||
    !body?.fileType ||
    !["gpx", "tcx"].includes(body.fileType)
  ) {
    throw createError({
      statusCode: 400,
      statusMessage: "Valid activity file fields are required",
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

  const parsed = parseActivityFile(body);
  const courseDistanceMeters =
    course.totalDistance ??
    (() => {
      const elevationProfile = extractElevationProfile(
        course.geoJsonData as GeoJSON.FeatureCollection,
      );
      return elevationProfile[elevationProfile.length - 1]?.distance || 0;
    })();

  const matchData = matchActivityToCourse({
    courseGeoJson: course.geoJsonData as GeoJSON.FeatureCollection,
    points: parsed.points,
    courseDistanceMeters,
  });
  const matchStatus = getMatchStatusFromData(matchData);
  const matchConfidence = getMatchConfidence(matchData);

  if (body.isPrimary !== false) {
    await cloudDb
      .update(courseActivities)
      .set({
        isPrimary: false,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(courseActivities.courseId, courseId),
          eq(courseActivities.userId, session.user.id),
        ),
      );
  }

  const inserted = await cloudDb
    .insert(courseActivities)
    .values({
      courseId,
      userId: session.user.id,
      sourceFileName: body.sourceFileName,
      fileType: body.fileType,
      provider: parsed.provider,
      originalFileContent: body.originalFileContent,
      geoJsonData: parsed.geoJsonData,
      startedAt: parsed.startedAt,
      endedAt: parsed.endedAt,
      elapsedTimeSeconds: parsed.elapsedTimeSeconds,
      recordedDistanceMeters: parsed.recordedDistanceMeters,
      matchedDistanceMeters:
        matchData.samples[matchData.samples.length - 1]?.distanceMeters || 0,
      matchStatus,
      matchConfidence,
      isPrimary: body.isPrimary !== false,
      matchData,
    })
    .returning();

  return {
    activity: inserted[0],
  };
});
