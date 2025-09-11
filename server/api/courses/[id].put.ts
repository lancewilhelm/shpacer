import { courses, userCourses } from "~/utils/db/schema";
import { cloudDb } from "~~/server/utils/db/cloud";
import { eq, and } from "drizzle-orm";
import { auth } from "~/utils/auth";

interface UpdateCourseRequest {
  name?: string;
  description?: string;
  raceDate?: string | null;
  public?: boolean;
  shareEnabled?: boolean;
}

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

    const body = await readBody<UpdateCourseRequest>(event);

    // Check membership & ownership via user_courses
    const [membership] = await cloudDb
      .select({ role: userCourses.role })
      .from(userCourses)
      .where(
        and(
          eq(userCourses.courseId, courseId),
          eq(userCourses.userId, session.user.id),
        ),
      )
      .limit(1);

    if (!membership) {
      throw createError({
        statusCode: 404,
        statusMessage: "Course not found or access denied",
      });
    }

    if (membership.role !== "owner") {
      throw createError({
        statusCode: 403,
        statusMessage: "Only the owner can modify this course",
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
        updateData.raceDate = new Date(
          Date.UTC(
            date.getFullYear(),
            date.getMonth(),
            date.getDate(),
            date.getHours(),
            date.getMinutes(),
          ),
        );
      } else {
        updateData.raceDate = null;
      }
    }

    if (body.public !== undefined) {
      updateData.public = body.public;
    }

    if (body.shareEnabled !== undefined) {
      updateData.shareEnabled = body.shareEnabled;
    }

    const [updatedCourse] = await cloudDb
      .update(courses)
      .set(updateData)
      .where(eq(courses.id, courseId))
      .returning();

    return {
      success: true,
      course: {
        ...updatedCourse,
        role: membership.role, // preserve membership role so frontend menu toggles correctly
      },
    };
  } catch (error) {
    console.error("Error updating course:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to update course",
    });
  }
});
