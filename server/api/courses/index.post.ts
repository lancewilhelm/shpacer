import { courses, waypoints } from "~/utils/db/schema";
import { cloudDb } from "~~/server/utils/db/cloud";
import { auth } from "~/utils/auth";
import { calculateCourseMetrics } from "~/utils/courseMetrics";
import { processAllWaypoints } from "~/utils/waypoints";

interface CreateCourseRequest {
  name: string;
  description?: string;
  originalFileName: string;
  originalFileContent: string;
  fileType: 'gpx' | 'tcx';
  geoJsonData: GeoJSON.FeatureCollection;
  raceDate?: string | null;
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

    const body = await readBody<CreateCourseRequest>(event);
    
    // Validate required fields
    if (!body.name || !body.originalFileName || !body.originalFileContent || !body.fileType || !body.geoJsonData) {
      throw createError({
        statusCode: 400,
        statusMessage: "Missing required fields"
      });
    }

    // Calculate course metrics
    const metrics = calculateCourseMetrics(body.geoJsonData);

    // Process waypoints from the GeoJSON data
    const waypointData = processAllWaypoints(body.geoJsonData);

    // Create the course
    const [newCourse] = await cloudDb
      .insert(courses)
      .values({
        name: body.name,
        description: body.description || null,
        userId: session.user.id,
        originalFileName: body.originalFileName,
        originalFileContent: body.originalFileContent,
        fileType: body.fileType,
        geoJsonData: body.geoJsonData,
        totalDistance: metrics.totalDistance,
        elevationGain: metrics.elevationGain,
        elevationLoss: metrics.elevationLoss,
        raceDate: body.raceDate ? (() => {
          // Parse the datetime string (format: YYYY-MM-DDTHH:MM:SS)
          const date = new Date(body.raceDate);
          return new Date(Date.UTC(
            date.getFullYear(),
            date.getMonth(),
            date.getDate(),
            date.getHours(),
            date.getMinutes()
          ));
        })() : null,
      })
      .returning();

    // Insert waypoints if any were found
    if (waypointData.length > 0 && newCourse.id) {
      const waypointInserts = waypointData.map(wp => ({
        courseId: newCourse.id,
        name: wp.name,
        description: wp.description || null,
        lat: wp.lat.toString(),
        lng: wp.lng.toString(),
        elevation: wp.elevation || null,
        distance: wp.distance,
        type: wp.type,
        icon: wp.icon || null,
        order: wp.order,
      }));

      await cloudDb.insert(waypoints).values(waypointInserts);
    }

    return {
      success: true,
      course: newCourse
    };
  } catch (error) {
    console.error("Error creating course:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to create course"
    });
  }
});
