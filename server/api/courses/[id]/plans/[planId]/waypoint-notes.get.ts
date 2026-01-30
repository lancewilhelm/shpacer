import { eq, and } from "drizzle-orm";
import { waypointNotes, plans } from "~/utils/db/schema";
import { cloudDb } from "~~/server/utils/db/cloud";
import { auth } from "~/utils/auth";
import { setHeader } from "h3";

export default defineEventHandler(async (event) => {
  const t0 = Date.now();
  const session = await auth.api.getSession({
    headers: event.headers,
  });

  if (!session) {
    throw createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
    });
  }

  const tAuth = Date.now() - t0;
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
    const tPlanStart = Date.now();
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
    const tPlan = Date.now() - tPlanStart;

    if (plan.length === 0) {
      throw createError({
        statusCode: 404,
        statusMessage: "Plan not found",
      });
    }

    // Get all waypoint notes for this plan
    const tNotesStart = Date.now();
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
    const tNotes = Date.now() - tNotesStart;
    const total = Date.now() - t0;

    // Add Server-Timing header and step-wise logging (auth, plan, notes, total)
    const serverTiming = [
      `auth;dur=${tAuth}`,
      `plan;dur=${tPlan}`,
      `notes;dur=${tNotes}`,
      `total;dur=${total}`,
    ].join(", ");
    try {
      setHeader(event, "Server-Timing", serverTiming);
    } catch {}

    console.log("[api] waypoint-notes.get", {
      userId: session.user.id,
      courseId,
      planId,
      durations: { auth: tAuth, plan: tPlan, notes: tNotes, total },
      count: notes.length,
    });

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
