import { courses } from "~/utils/db/schema";
import { cloudDb } from "~~/server/utils/db/cloud";
import { eq, desc } from "drizzle-orm";
import { auth } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  try {
    const session = await auth.api.getSession({
      headers: event.headers,
    });
    
    if (!session?.user?.id) {
      throw createError({
        statusCode: 401,
        statusMessage: "Unauthorized"
      });
    }

    // Get all courses for the user (without file content for performance)
    const userCourses = await cloudDb
      .select({
        id: courses.id,
        name: courses.name,
        description: courses.description,
        originalFileName: courses.originalFileName,
        fileType: courses.fileType,
        totalDistance: courses.totalDistance,
        elevationGain: courses.elevationGain,
        elevationLoss: courses.elevationLoss,
        raceDate: courses.raceDate,
        createdAt: courses.createdAt,
        updatedAt: courses.updatedAt,
      })
      .from(courses)
      .where(eq(courses.userId, session.user.id))
      .orderBy(desc(courses.createdAt));

    return {
      courses: userCourses,
      total: userCourses.length
    };
  } catch (error) {
    console.error("Error fetching courses:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to fetch courses"
    });
  }
});
