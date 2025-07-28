import { eq, and } from "drizzle-orm";
import { waypointNotes, plans, waypoints } from "~/utils/db/schema";
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

  const body = await readBody(event);

  if (!body.waypointId || typeof body.waypointId !== "string") {
    throw createError({
      statusCode: 400,
      statusMessage: "Waypoint ID is required",
    });
  }

  if (!body.notes || typeof body.notes !== "string") {
    throw createError({
      statusCode: 400,
      statusMessage: "Notes content is required",
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

    // Verify the waypoint exists and belongs to the course
    const waypoint = await cloudDb
      .select()
      .from(waypoints)
      .where(
        and(
          eq(waypoints.id, body.waypointId),
          eq(waypoints.courseId, courseId),
        ),
      )
      .limit(1);

    if (waypoint.length === 0) {
      throw createError({
        statusCode: 404,
        statusMessage: "Waypoint not found",
      });
    }

    // Check if a note already exists for this waypoint and plan
    const existingNote = await cloudDb
      .select()
      .from(waypointNotes)
      .where(
        and(
          eq(waypointNotes.planId, planId),
          eq(waypointNotes.waypointId, body.waypointId),
          eq(waypointNotes.userId, session.user.id),
        ),
      )
      .limit(1);

    let result;

    if (existingNote.length > 0) {
      // Update existing note
      result = await cloudDb
        .update(waypointNotes)
        .set({
          notes: body.notes.trim(),
          updatedAt: new Date(),
        })
        .where(eq(waypointNotes.id, existingNote[0].id))
        .returning();
    } else {
      // Create new note
      result = await cloudDb
        .insert(waypointNotes)
        .values({
          planId,
          waypointId: body.waypointId,
          userId: session.user.id,
          notes: body.notes.trim(),
        })
        .returning();
    }

    return {
      note: result[0],
    };
  } catch (error: unknown) {
    console.error("Error saving waypoint note:", error);
    if (error && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to save waypoint note",
    });
  }
});
