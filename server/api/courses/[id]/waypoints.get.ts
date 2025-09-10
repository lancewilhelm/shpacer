import { waypoints, userCourses } from "~/utils/db/schema";
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
    if (!courseId) {
      throw createError({
        statusCode: 400,
        statusMessage: "Course ID is required",
      });
    }

    // Verify membership (owner or added)
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

    // Fetch waypoints for this course
    const courseWaypoints = await cloudDb
      .select()
      .from(waypoints)
      .where(eq(waypoints.courseId, courseId))
      .orderBy(waypoints.order);

    // Convert stored waypoints to proper format
    const formattedWaypoints = courseWaypoints.map((waypoint) => ({
      id: waypoint.id,
      name: waypoint.name,
      description: waypoint.description,
      lat: parseFloat(waypoint.lat),
      lng: parseFloat(waypoint.lng),
      elevation: waypoint.elevation,
      distance: waypoint.distance,
      tags: JSON.parse(waypoint.tags as string),
      order: waypoint.order,
    }));

    return {
      waypoints: formattedWaypoints,
    };
  } catch (error) {
    console.error("Error fetching waypoints:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to fetch waypoints",
    });
  }
});
