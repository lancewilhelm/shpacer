import { courses, waypoints } from "~/utils/db/schema";
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
    const waypointId = getRouterParam(event, "waypointId");

    if (!courseId || !waypointId) {
      throw createError({
        statusCode: 400,
        statusMessage: "Course ID and Waypoint ID are required",
      });
    }

    // Verify waypoint belongs to user's course and get waypoint info
    const [existingWaypoint] = await cloudDb
      .select({
        id: waypoints.id,
        order: waypoints.order,
        courseUserId: courses.userId,
      })
      .from(waypoints)
      .innerJoin(courses, eq(courses.id, waypoints.courseId))
      .where(
        and(
          eq(waypoints.id, waypointId),
          eq(waypoints.courseId, courseId),
          eq(courses.userId, session.user.id),
        ),
      )
      .limit(1);

    if (!existingWaypoint) {
      throw createError({
        statusCode: 404,
        statusMessage: "Waypoint not found or access denied",
      });
    }

    // Get all waypoints for this course to determine start/finish positions
    const allWaypoints = await cloudDb
      .select({
        order: waypoints.order,
      })
      .from(waypoints)
      .where(eq(waypoints.courseId, courseId))
      .orderBy(waypoints.order);

    // Don't allow deleting start or finish waypoints (first and last by order)
    const sortedOrders = allWaypoints.map((w) => w.order).sort((a, b) => a - b);
    const isStartWaypoint = existingWaypoint.order === sortedOrders[0];
    const isFinishWaypoint =
      existingWaypoint.order === sortedOrders[sortedOrders.length - 1];

    if (isStartWaypoint || isFinishWaypoint) {
      throw createError({
        statusCode: 400,
        statusMessage: "Cannot delete start or finish waypoints",
      });
    }

    // Delete the waypoint
    await cloudDb.delete(waypoints).where(eq(waypoints.id, waypointId));

    return {
      success: true,
      message: "Waypoint deleted successfully",
    };
  } catch (error) {
    console.error("Error deleting waypoint:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to delete waypoint",
    });
  }
});
