import { courses, waypoints } from "~/utils/db/schema";
import { cloudDb } from "~~/server/utils/db/cloud";
import { eq, and } from "drizzle-orm";
import { auth } from "~/utils/auth";

interface UpdateWaypointRequest {
  id: string;
  name?: string;
  description?: string;
  distance?: number;
  lat?: number;
  lng?: number;
  tags?: string[];
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

    const courseId = getRouterParam(event, "id");
    if (!courseId) {
      throw createError({
        statusCode: 400,
        statusMessage: "Course ID is required"
      });
    }

    const body = await readBody<UpdateWaypointRequest>(event);
    
    if (!body.id) {
      throw createError({
        statusCode: 400,
        statusMessage: "Waypoint ID is required"
      });
    }

    // Verify waypoint belongs to user's course
    const [existingWaypoint] = await cloudDb
      .select({ courseUserId: waypoints.courseId })
      .from(waypoints)
      .innerJoin(courses, eq(courses.id, waypoints.courseId))
      .where(and(
        eq(waypoints.id, body.id),
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

    // Build update data
    const updateData: Partial<typeof waypoints.$inferSelect> = {
      updatedAt: new Date(),
    };

    if (body.name !== undefined) {
      updateData.name = body.name;
    }

    if (body.description !== undefined) {
      updateData.description = body.description;
    }

    if (body.tags !== undefined) {
      updateData.tags = JSON.stringify(body.tags);
    }

    if (body.distance !== undefined) {
      updateData.distance = body.distance;
      updateData.order = Math.floor(body.distance); // Update order based on distance
    }

    if (body.lat !== undefined) {
      updateData.lat = body.lat.toString();
    }

    if (body.lng !== undefined) {
      updateData.lng = body.lng.toString();
    }

    // Update the waypoint
    const [updatedWaypoint] = await cloudDb
      .update(waypoints)
      .set(updateData)
      .where(eq(waypoints.id, body.id))
      .returning();

    // Convert to proper format for frontend
    const formattedWaypoint = {
      id: updatedWaypoint.id,
      name: updatedWaypoint.name,
      description: updatedWaypoint.description,
      lat: parseFloat(updatedWaypoint.lat),
      lng: parseFloat(updatedWaypoint.lng),
      elevation: updatedWaypoint.elevation,
      distance: updatedWaypoint.distance,
      tags: JSON.parse(updatedWaypoint.tags as string),
      order: updatedWaypoint.order,
    };

    return {
      success: true,
      waypoint: formattedWaypoint
    };
  } catch (error) {
    console.error("Error updating waypoint:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to update waypoint"
    });
  }
});
