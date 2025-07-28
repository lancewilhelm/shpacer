import { eq, and } from "drizzle-orm";
import { waypointNotes, plans } from "~/utils/db/schema";
import { cloudDb } from "~~/server/utils/db/cloud";
import { auth } from "~/utils/auth";

export default defineEventHandler(async (event) => {
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
  const waypointId = getRouterParam(event, "waypointId");

  if (!courseId) {
    throw createError({
      statusCode: 400,
      statusMessage: "Course ID is required",
    });
  }

  if (!planId) {
    throw createError({
      statusCode: 400,
      statusMessage: "Plan ID is required",
    });
  }

  if (!waypointId) {
    throw createError({
      statusCode: 400,
      statusMessage: "Waypoint ID is required",
    });
  }

  try {
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

    // Find and delete the waypoint note
    const existingNote = await cloudDb
      .select()
      .from(waypointNotes)
      .where(
        and(
          eq(waypointNotes.planId, planId),
          eq(waypointNotes.waypointId, waypointId),
          eq(waypointNotes.userId, session.user.id),
        ),
      )
      .limit(1);

    if (existingNote.length === 0) {
      throw createError({
        statusCode: 404,
        statusMessage: "Waypoint note not found",
      });
    }

    await cloudDb
      .delete(waypointNotes)
      .where(eq(waypointNotes.id, existingNote[0].id));

    return {
      success: true,
      message: "Waypoint note deleted successfully",
    };
  } catch (error: unknown) {
    console.error("Error deleting waypoint note:", error);
    if (error && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to delete waypoint note",
    });
  }
});
