import { courses } from "~/utils/db/schema";
import { cloudDb } from "~~/server/utils/db/cloud";
import { eq } from "drizzle-orm";
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

    const courseId = getRouterParam(event, 'id');
    
    if (!courseId) {
      throw createError({
        statusCode: 400,
        statusMessage: "Course ID is required"
      });
    }

    // Get the course with GeoJSON data
    const [course] = await cloudDb
      .select()
      .from(courses)
      .where(eq(courses.id, courseId))
      .limit(1);

    if (!course) {
      throw createError({
        statusCode: 404,
        statusMessage: "Course not found"
      });
    }

    // Check if user owns this course
    if (course.userId !== session.user.id) {
      throw createError({
        statusCode: 403,
        statusMessage: "Access denied"
      });
    }

    return {
      course
    };
  } catch (error) {
    console.error("Error fetching course:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to fetch course"
    });
  }
});
