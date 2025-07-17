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
        statusMessage: "Unauthorized"
      });
    }

    const courseId = getRouterParam(event, "id");
    const waypointId = getRouterParam(event, "waypointId");
    
    if (!courseId || !waypointId) {
      throw createError({
        statusCode: 400,
        statusMessage: "Course ID and Waypoint ID are required"
      });
    }

    // Verify waypoint belongs to user's course and get waypoint info
    const [existingWaypoint] = await cloudDb
      .select({
        id: waypoints.id,
        type: waypoints.type,
        courseUserId: courses.userId
      })
      .from(waypoints)
      .innerJoin(courses, eq(courses.id, waypoints.courseId))
      .where(and(
        eq(waypoints.id, waypointId),
        eq(waypoints.courseId, courseId),
        eq(courses.userId, session.user.id)
      ))
      .limit(1);

    if (!existingWaypoint) {
      throw createError({
        statusCode: 404,
        statusMessage: "Waypoint not found or access denied"
      });
    }

    // Don't allow deleting start or finish waypoints
    if (existingWaypoint.type === 'start' || existingWaypoint.type === 'finish') {
      throw createError({
        statusCode: 400,
        statusMessage: "Cannot delete start or finish waypoints"
      });
    }

    // Delete the waypoint
    await cloudDb
      .delete(waypoints)
      .where(eq(waypoints.id, waypointId));

    return {
      success: true,
      message: "Waypoint deleted successfully"
    };
  } catch (error) {
    console.error("Error deleting waypoint:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to delete waypoint"
    });
  }
});
