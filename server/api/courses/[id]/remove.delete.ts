import { defineEventHandler, createError, getRouterParam } from "#imports";
import { auth } from "~/utils/auth";
import { cloudDb } from "~~/server/utils/db/cloud";
import {
  userCourses,
  plans,
  waypointNotes,
  waypointStoppageTimes,
} from "~/utils/db/schema";
import { and, eq, inArray } from "drizzle-orm";

/**
 * DELETE /api/courses/:id/remove
 *
 * Unstars a course (removes user's membership with role='starred'; legacy 'added' also supported).
 *
 * Additional behavior:
 * - All user-specific plans for this course (and their waypoint notes / stoppage times)
 *   are deleted when the user removes the course from "My Courses".
 *
 * Rules:
 * - Auth required.
 * - If membership doesn't exist: 404.
 * - If membership exists but role='owner': reject (cannot remove ownership).
 * - If membership exists and role='starred' (or legacy 'added'): delete it (and cascade user-owned plan data).
 *
 * Response (success):
 * {
 *   success: true,
 *   removed: true,
 *   courseId: string,
 *   deletedPlanCount: number
 * }
 */
export default defineEventHandler(async (event) => {
  // Authenticate
  const session = await auth.api.getSession({ headers: event.headers });
  if (!session?.user?.id) {
    throw createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
    });
  }
  const userId = session.user.id;

  // Get course ID
  const courseId = getRouterParam(event, "id");
  if (!courseId) {
    throw createError({
      statusCode: 400,
      statusMessage: "Course ID is required",
    });
  }

  try {
    // Fetch membership
    const [membership] = await cloudDb
      .select({
        userId: userCourses.userId,
        courseId: userCourses.courseId,
        role: userCourses.role,
      })
      .from(userCourses)
      .where(
        and(eq(userCourses.userId, userId), eq(userCourses.courseId, courseId)),
      )
      .limit(1);

    if (!membership) {
      throw createError({
        statusCode: 404,
        statusMessage: "Membership not found",
      });
    }

    if (membership.role === "owner") {
      throw createError({
        statusCode: 400,
        statusMessage: "Cannot remove course ownership",
      });
    }

    // Collect user's plan IDs for this course (user-specific content)
    const userPlans = await cloudDb
      .select({ id: plans.id })
      .from(plans)
      .where(and(eq(plans.courseId, courseId), eq(plans.userId, userId)));

    let deletedPlanCount = 0;
    if (userPlans.length > 0) {
      const planIds = userPlans.map((p) => p.id);

      // Delete dependent waypoint notes
      await cloudDb
        .delete(waypointNotes)
        .where(inArray(waypointNotes.planId, planIds));

      // Delete dependent waypoint stoppage times
      await cloudDb
        .delete(waypointStoppageTimes)
        .where(inArray(waypointStoppageTimes.planId, planIds));

      // Delete plans
      await cloudDb.delete(plans).where(inArray(plans.id, planIds));

      deletedPlanCount = planIds.length;
    }

    // Delete the starred membership (supports legacy role='added')
    await cloudDb
      .delete(userCourses)
      .where(
        and(
          eq(userCourses.userId, userId),
          eq(userCourses.courseId, courseId),
          inArray(userCourses.role, ["starred", "added"]),
        ),
      );

    return {
      success: true,
      removed: true,
      courseId,
      deletedPlanCount,
    };
  } catch (error) {
    if (error && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error("Error removing course membership:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to remove course membership",
    });
  }
});
