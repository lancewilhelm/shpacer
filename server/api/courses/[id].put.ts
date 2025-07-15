import { courses } from "~/utils/db/schema";
import { cloudDb } from "~~/server/utils/db/cloud";
import { eq } from "drizzle-orm";
import { auth } from "~/utils/auth";

interface UpdateCourseRequest {
  name?: string;
  description?: string;
  raceDate?: string | null;
}

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

    const body = await readBody<UpdateCourseRequest>(event);
    
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

    // Update the course
    const updateData: Partial<typeof courses.$inferSelect> = {
      updatedAt: new Date(),
    };

    if (body.name !== undefined) {
      updateData.name = body.name;
    }

    if (body.description !== undefined) {
      updateData.description = body.description;
    }

    if (body.raceDate !== undefined) {
      if (body.raceDate) {
        // Parse the datetime string (format: YYYY-MM-DDTHH:MM:SS)
        const date = new Date(body.raceDate);
        updateData.raceDate = new Date(Date.UTC(
          date.getFullYear(),
          date.getMonth(),
          date.getDate(),
          date.getHours(),
          date.getMinutes()
        ));
      } else {
        updateData.raceDate = null;
      }
    }

    const [updatedCourse] = await cloudDb
      .update(courses)
      .set(updateData)
      .where(eq(courses.id, courseId))
      .returning();

    return {
      success: true,
      course: updatedCourse
    };
  } catch (error) {
    console.error("Error updating course:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to update course"
    });
  }
});
