import { courses, waypoints } from "~/utils/db/schema";
import { cloudDb } from "~~/server/utils/db/cloud";
import { eq, and } from "drizzle-orm";
import { auth } from "~/utils/auth";

interface CreateWaypointRequest {
  name: string;
  description?: string;
  lat: number;
  lng: number;
  distance: number;
  tags?: string[];
  elevation?: number;
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

    const body = await readBody<CreateWaypointRequest>(event);
    
    if (!body.name || body.lat === undefined || body.lng === undefined || body.distance === undefined) {
      throw createError({
        statusCode: 400,
        statusMessage: "Name, latitude, longitude, and distance are required"
      });
    }

    // Verify course belongs to user
    const [course] = await cloudDb
      .select({ id: courses.id })
      .from(courses)
      .where(and(
        eq(courses.id, courseId),
        eq(courses.userId, session.user.id)
      ))
      .limit(1);

    if (!course) {
      throw createError({
        statusCode: 404,
        statusMessage: "Course not found or access denied"
      });
    }

    // Create the waypoint
    const [newWaypoint] = await cloudDb
      .insert(waypoints)
      .values({
        courseId: courseId,
        name: body.name,
        description: body.description || null,
        lat: body.lat.toString(),
        lng: body.lng.toString(),
        elevation: body.elevation || null,
        distance: body.distance,
        tags: JSON.stringify(body.tags || []),
        order: Math.floor(body.distance),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    // Convert to proper format for frontend
    const formattedWaypoint = {
      id: newWaypoint.id,
      name: newWaypoint.name,
      description: newWaypoint.description,
      lat: parseFloat(newWaypoint.lat),
      lng: parseFloat(newWaypoint.lng),
      elevation: newWaypoint.elevation,
      distance: newWaypoint.distance,
      tags: JSON.parse(newWaypoint.tags as string),
      order: newWaypoint.order,
    };

    return {
      success: true,
      waypoint: formattedWaypoint
    };
  } catch (error) {
    console.error("Error creating waypoint:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to create waypoint"
    });
  }
});
