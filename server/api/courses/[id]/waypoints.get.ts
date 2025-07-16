import { courses, waypoints } from "~/utils/db/schema";
import { cloudDb } from "~~/server/utils/db/cloud";
import { eq } from "drizzle-orm";
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
    if (!courseId) {
      throw createError({
        statusCode: 400,
        statusMessage: "Course ID is required"
      });
    }

    // Verify course belongs to user
    const [course] = await cloudDb.select()
      .from(courses)
      .where(eq(courses.id, courseId))
      .limit(1);

    if (!course) {
      throw createError({
        statusCode: 404,
        statusMessage: "Course not found"
      });
    }

    if (course.userId !== session.user.id) {
      throw createError({
        statusCode: 403,
        statusMessage: "Access denied"
      });
    }

    // Fetch waypoints for this course
    const courseWaypoints = await cloudDb.select()
      .from(waypoints)
      .where(eq(waypoints.courseId, courseId))
      .orderBy(waypoints.order);

    // Convert stored waypoints to proper format
    const formattedWaypoints = courseWaypoints.map(waypoint => ({
      id: waypoint.id,
      name: waypoint.name,
      description: waypoint.description,
      lat: parseFloat(waypoint.lat),
      lng: parseFloat(waypoint.lng),
      elevation: waypoint.elevation,
      distance: waypoint.distance,
      type: waypoint.type as 'start' | 'finish' | 'waypoint' | 'poi',
      icon: waypoint.icon,
      order: waypoint.order,
    }));

    return {
      waypoints: formattedWaypoints
    };
  } catch (error) {
    console.error("Error fetching waypoints:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to fetch waypoints"
    });
  }
});
