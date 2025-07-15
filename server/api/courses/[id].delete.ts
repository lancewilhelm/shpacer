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

    // Check if course exists and user owns it
    const [existingCourse] = await cloudDb
      .select({ userId: courses.userId })
      .from(courses)
      .where(eq(courses.id, courseId))
      .limit(1);

    if (!existingCourse) {
      throw createError({
        statusCode: 404,
        statusMessage: "Course not found"
      });
    }

    if (existingCourse.userId !== session.user.id) {
      throw createError({
        statusCode: 403,
        statusMessage: "Access denied"
      });
    }

    // Delete the course
    await cloudDb
      .delete(courses)
      .where(eq(courses.id, courseId));

    return {
      success: true,
      message: "Course deleted successfully"
    };
  } catch (error) {
    console.error("Error deleting course:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to delete course"
    });
  }
});
