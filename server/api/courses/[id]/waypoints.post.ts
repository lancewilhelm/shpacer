import { waypoints, userCourses } from "~/utils/db/schema";
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

    const body = await readBody<CreateWaypointRequest>(event);

    if (
      !body.name ||
      body.lat === undefined ||
      body.lng === undefined ||
      body.distance === undefined
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: "Name, latitude, longitude, and distance are required",
      });
    }

    if (
      !Number.isFinite(body.lat) ||
      !Number.isFinite(body.lng) ||
      !Number.isFinite(body.distance)
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: "Latitude, longitude, and distance must be valid numbers",
      });
    }

    const normalizedDistance = Math.round(body.distance);
    if (normalizedDistance < 0) {
      throw createError({
        statusCode: 400,
        statusMessage: "Distance must be greater than or equal to 0",
      });
    }

    // Verify user is owner via user_courses membership
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
        statusMessage: "Only the owner can add waypoints",
      });
    }

    const existingWaypoints = await cloudDb
      .select({
        id: waypoints.id,
        distance: waypoints.distance,
      })
      .from(waypoints)
      .where(eq(waypoints.courseId, courseId));

    const duplicateWaypoint = existingWaypoints.find(
      (waypoint) => waypoint.distance === normalizedDistance,
    );

    if (duplicateWaypoint) {
      throw createError({
        statusCode: 409,
        statusMessage:
          "A waypoint already exists at this course position. Choose a different position.",
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
        distance: normalizedDistance,
        tags: JSON.stringify(body.tags || []),
        order: Math.floor(normalizedDistance),
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
      waypoint: formattedWaypoint,
    };
  } catch (error) {
    if (error && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error("Error creating waypoint:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to create waypoint",
    });
  }
});
