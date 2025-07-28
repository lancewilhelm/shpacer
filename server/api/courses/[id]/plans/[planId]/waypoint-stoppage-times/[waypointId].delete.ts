import { eq, and } from "drizzle-orm";
import { waypointStoppageTimes, plans } from "~/utils/db/schema";
import { cloudDb } from "~~/server/utils/db/cloud";
import { auth } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  try {
    const session = await auth.api.getSession({
      headers: event.headers,
    });

    if (!session) {
      throw createError({
        statusCode: 401,
        statusMessage: "Unauthorized",
      });
    }

    const courseId = getRouterParam(event, "id");
    const planId = getRouterParam(event, "planId");
    const waypointId = getRouterParam(event, "waypointId");

    if (!courseId || !planId || !waypointId) {
      throw createError({
        statusCode: 400,
        statusMessage: "Course ID, Plan ID, and Waypoint ID are required",
      });
    }

    // Verify the plan exists and belongs to the user
    const plan = await cloudDb
      .select()
      .from(plans)
      .where(
        and(
          eq(plans.id, planId),
          eq(plans.courseId, courseId),
          eq(plans.userId, session.user.id),
        ),
      )
      .limit(1);

    if (plan.length === 0) {
      throw createError({
        statusCode: 404,
        statusMessage: "Plan not found",
      });
    }

    // Delete the waypoint stoppage time
    await cloudDb
      .delete(waypointStoppageTimes)
      .where(
        and(
          eq(waypointStoppageTimes.planId, planId),
          eq(waypointStoppageTimes.waypointId, waypointId),
        ),
      );

    return {
      success: true,
    };
  } catch (error: unknown) {
    console.error("Error deleting waypoint stoppage time:", error);

    if (error && typeof error === "object" && "statusCode" in error) {
      throw error;
    }

    throw createError({
      statusCode: 500,
      statusMessage: "Internal server error",
    });
  }
});
