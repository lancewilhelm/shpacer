import { courses, waypoints } from "~/utils/db/schema";
import { cloudDb } from "~~/server/utils/db/cloud";
import { eq, and } from "drizzle-orm";
import { auth } from "~/utils/auth";

type EndpointWaypoint = {
  id: string;
  distance: number;
  name: string;
  createdAt: Date;
};

function pickCanonicalEndpointWaypoint(
  candidates: EndpointWaypoint[],
  endpoint: "start" | "finish",
): EndpointWaypoint | null {
  if (candidates.length === 0) return null;

  const preferredLabel = endpoint === "start" ? "start" : "finish";
  const preferredLabelMatch = candidates.find((candidate) => {
    const normalizedName = candidate.name.trim().toLowerCase();
    return (
      normalizedName === preferredLabel ||
      normalizedName === preferredLabel[0]
    );
  });
  if (preferredLabelMatch) return preferredLabelMatch;

  return (
    [...candidates].sort((a, b) => {
      const createdAtDiff = a.createdAt.getTime() - b.createdAt.getTime();
      if (createdAtDiff !== 0) return createdAtDiff;
      return a.id.localeCompare(b.id);
    })[0] ?? null
  );
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
        distance: waypoints.distance,
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
        id: waypoints.id,
        distance: waypoints.distance,
        name: waypoints.name,
        createdAt: waypoints.createdAt,
      })
      .from(waypoints)
      .where(eq(waypoints.courseId, courseId))
      .orderBy(waypoints.distance);

    const minDistance = Math.min(...allWaypoints.map((waypoint) => waypoint.distance));
    const maxDistance = Math.max(...allWaypoints.map((waypoint) => waypoint.distance));

    const startWaypoint = pickCanonicalEndpointWaypoint(
      allWaypoints.filter((waypoint) => waypoint.distance === minDistance),
      "start",
    );
    const finishWaypoint = pickCanonicalEndpointWaypoint(
      allWaypoints.filter((waypoint) => waypoint.distance === maxDistance),
      "finish",
    );

    const protectedWaypointIds = new Set<string>();
    if (startWaypoint) protectedWaypointIds.add(startWaypoint.id);
    if (finishWaypoint) protectedWaypointIds.add(finishWaypoint.id);

    if (protectedWaypointIds.has(existingWaypoint.id)) {
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
    if (error && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error("Error deleting waypoint:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to delete waypoint",
    });
  }
});
