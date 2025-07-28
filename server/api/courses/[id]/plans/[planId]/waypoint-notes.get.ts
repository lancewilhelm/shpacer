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

    // Get all waypoint notes for this plan
    const notes = await cloudDb
      .select()
      .from(waypointNotes)
      .where(
        and(
          eq(waypointNotes.planId, planId),
          eq(waypointNotes.userId, session.user.id),
        ),
      )
      .orderBy(waypointNotes.createdAt);

    return {
      notes,
    };
  } catch (error: unknown) {
    console.error("Error fetching waypoint notes:", error);
    if (error && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to fetch waypoint notes",
    });
  }
});
