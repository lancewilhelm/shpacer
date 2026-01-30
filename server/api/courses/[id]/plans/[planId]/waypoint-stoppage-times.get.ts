import { eq, and } from "drizzle-orm";
import { waypointStoppageTimes, plans } from "~/utils/db/schema";
import { cloudDb } from "~~/server/utils/db/cloud";
import { auth } from "~/utils/auth";
import { setHeader } from "h3";

export default defineEventHandler(async (event) => {
  const t0 = Date.now();
  try {
    const session = await auth.api.getSession({
      headers: event.headers,
    });
    const tAuth = Date.now() - t0;

    if (!session) {
      throw createError({
        statusCode: 401,
        statusMessage: "Unauthorized",
      });
    }

    const courseId = getRouterParam(event, "id");
    const planId = getRouterParam(event, "planId");

    if (!courseId || !planId) {
      throw createError({
        statusCode: 400,
        statusMessage: "Course ID and Plan ID are required",
      });
    }

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

    // Get all waypoint stoppage times for this plan
    const tStopStart = Date.now();
    const stoppageTimes = await cloudDb
      .select()
      .from(waypointStoppageTimes)
      .where(eq(waypointStoppageTimes.planId, planId));
    const tStop = Date.now() - tStopStart;
    const total = Date.now() - t0;

    const serverTiming = [
      `auth;dur=${tAuth}`,
      `plan;dur=${tPlan}`,
      `stoppages;dur=${tStop}`,
      `total;dur=${total}`,
    ].join(", ");
    try {
      setHeader(event, "Server-Timing", serverTiming);
    } catch {}

    console.log("[api] waypoint-stoppage-times.get", {
      userId: session.user.id,
      courseId,
      planId,
      durations: { auth: tAuth, plan: tPlan, stoppages: tStop, total },
      count: stoppageTimes.length,
    });

    return {
      stoppageTimes,
    };
  } catch (error: unknown) {
    console.error("Error fetching waypoint stoppage times:", error);

    if (error && typeof error === "object" && "statusCode" in error) {
      throw error;
    }

    throw createError({
      statusCode: 500,
      statusMessage: "Internal server error",
    });
  }
});
