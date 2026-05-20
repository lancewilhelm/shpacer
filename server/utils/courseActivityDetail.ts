import { and, eq } from "drizzle-orm"
import { extractElevationProfile } from "~/utils/elevationProfile"
import { getCourseActivityMatchData } from "~/utils/courseActivities"
import { courseActivities, courses, type SelectCourseActivity } from "~/utils/db/schema"
import { cloudDb } from "~~/server/utils/db/cloud"
import {
  getMatchConfidence,
  getMatchStatusFromData,
  hasImplausibleProgressJump,
  matchActivityToCourse,
  parseActivityFile,
} from "./courseActivities"

interface LoadCourseActivityDetailOptions {
  courseId: string;
  activityId: string;
  userId: string;
}

export async function loadCourseActivityDetail(
  options: LoadCourseActivityDetailOptions,
): Promise<SelectCourseActivity | null> {
  const [activity] = await cloudDb
    .select()
    .from(courseActivities)
    .where(
      and(
        eq(courseActivities.id, options.activityId),
        eq(courseActivities.courseId, options.courseId),
        eq(courseActivities.userId, options.userId),
      ),
    )
    .limit(1)

  if (!activity) {
    return null
  }

  const matchData = getCourseActivityMatchData(activity)
  if (!hasImplausibleProgressJump(matchData)) {
    return activity
  }

  const [course] = await cloudDb
    .select({
      geoJsonData: courses.geoJsonData,
      totalDistance: courses.totalDistance,
    })
    .from(courses)
    .where(eq(courses.id, options.courseId))
    .limit(1)

  if (!course) {
    return activity
  }

  const parsed = parseActivityFile({
    sourceFileName: activity.sourceFileName,
    originalFileContent: activity.originalFileContent,
    fileType: activity.fileType as "gpx" | "tcx",
  })

  const courseDistanceMeters =
    course.totalDistance ??
    (() => {
      const elevationProfile = extractElevationProfile(
        course.geoJsonData as GeoJSON.FeatureCollection,
      )
      return elevationProfile[elevationProfile.length - 1]?.distance || 0
    })()

  const repairedMatchData = matchActivityToCourse({
    courseGeoJson: course.geoJsonData as GeoJSON.FeatureCollection,
    points: parsed.points,
    courseDistanceMeters,
  })
  const repairedMatchStatus = getMatchStatusFromData(repairedMatchData)
  const repairedMatchConfidence = getMatchConfidence(repairedMatchData)

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
    .returning()

  return updated[0] ?? activity
}
