import { eq, and } from "drizzle-orm";
import { waypointStoppageTimes, plans, waypoints } from "~/utils/db/schema";
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

    if (!courseId || !planId) {
      throw createError({
        statusCode: 400,
        statusMessage: "Course ID and Plan ID are required",
      });
    }

    const body = await readBody(event);
    const { waypointId, stoppageTime } = body;

    if (!waypointId || typeof stoppageTime !== "number") {
      throw createError({
        statusCode: 400,
        statusMessage: "Waypoint ID and stoppage time are required",
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

    // Verify the waypoint exists and belongs to the course
    const waypoint = await cloudDb
      .select()
      .from(waypoints)
      .where(
        and(eq(waypoints.id, waypointId), eq(waypoints.courseId, courseId)),
      )
      .limit(1);

    if (waypoint.length === 0) {
      throw createError({
        statusCode: 404,
        statusMessage: "Waypoint not found",
      });
    }

    // Check if stoppage time already exists
    const existingStoppageTime = await cloudDb
      .select()
      .from(waypointStoppageTimes)
      .where(
        and(
          eq(waypointStoppageTimes.planId, planId),
          eq(waypointStoppageTimes.waypointId, waypointId),
        ),
      )
      .limit(1);

    if (existingStoppageTime.length > 0) {
      // Update existing stoppage time
      await cloudDb
        .update(waypointStoppageTimes)
        .set({
          stoppageTime: stoppageTime,
          updatedAt: new Date(),
        })
        .where(eq(waypointStoppageTimes.id, existingStoppageTime[0].id));
    } else {
      // Create new stoppage time
      await cloudDb.insert(waypointStoppageTimes).values({
        planId: planId,
        waypointId: waypointId,
        stoppageTime: stoppageTime,
      });
    }

    return {
      success: true,
    };
  } catch (error: unknown) {
    console.error("Error saving waypoint stoppage time:", error);

    if (error && typeof error === "object" && "statusCode" in error) {
      throw error;
    }

    throw createError({
      statusCode: 500,
      statusMessage: "Internal server error",
    });
  }
});
