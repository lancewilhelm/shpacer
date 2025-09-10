import { courses, userCourses } from "~/utils/db/schema";
import { cloudDb } from "~~/server/utils/db/cloud";
import { eq, and } from "drizzle-orm";
import { auth } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  try {
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

    // Get the course with GeoJSON data
    const [course] = await cloudDb
      .select({
        id: courses.id,
        name: courses.name,
        description: courses.description,
        originalFileName: courses.originalFileName,
        originalFileContent: courses.originalFileContent,
        fileType: courses.fileType,
        geoJsonData: courses.geoJsonData,
        totalDistance: courses.totalDistance,
        elevationGain: courses.elevationGain,
        elevationLoss: courses.elevationLoss,
        raceDate: courses.raceDate,
        createdAt: courses.createdAt,
        updatedAt: courses.updatedAt,
        userId: courses.userId,
        public: courses.public,
        forkedFromCourseId: courses.forkedFromCourseId,
        role: userCourses.role,
      })
      .from(userCourses)
      .innerJoin(courses, eq(userCourses.courseId, courses.id))
      .where(
        and(
          eq(userCourses.courseId, courseId),
          eq(userCourses.userId, session.user.id),
        ),
      )
      .limit(1);

    if (!course) {
      throw createError({
        statusCode: 404,
        statusMessage: "Course not found",
      });
    }

    // Access authorized via membership join (userCourses). Role included in response.

    return {
      course,
    };
  } catch (error) {
    console.error("Error fetching course:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to fetch course",
    });
  }
});
