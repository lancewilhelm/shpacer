import { eq, and } from "drizzle-orm";
import { plans, userCourses } from "~/utils/db/schema";
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

  if (!courseId) {
    throw createError({
      statusCode: 400,
      statusMessage: "Course ID is required",
    });
  }

  const body = await readBody(event);

  if (!body.name || typeof body.name !== "string" || body.name.trim() === "") {
    throw createError({
      statusCode: 400,
      statusMessage: "Plan name is required",
    });
  }

  try {
    // Verify membership (owner or added)
    const membership = await cloudDb
      .select({ role: userCourses.role })
      .from(userCourses)
      .where(
        and(
          eq(userCourses.courseId, courseId),
          eq(userCourses.userId, session.user.id),
        ),
      )
      .limit(1);

    if (membership.length === 0) {
      throw createError({
        statusCode: 404,
        statusMessage: "Course not found or access denied",
      });
    }

    // Create the new plan
    const newPlan = await cloudDb
      .insert(plans)
      .values({
        courseId,
        userId: session.user.id,
        name: body.name.trim(),
        pace: body.pace || null,
        paceUnit: body.paceUnit || "min_per_km",
        paceMode: body.paceMode || "pace",
        targetTimeSeconds: body.targetTimeSeconds ?? null,
        defaultStoppageTime: body.defaultStoppageTime || 0,
        useGradeAdjustment: body.useGradeAdjustment ?? true,
        pacingStrategy: body.pacingStrategy || "flat",
        pacingLinearPercent: body.pacingLinearPercent ?? 0,
      })
      .returning();

    return {
      plan: newPlan[0],
    };
  } catch (error: unknown) {
    console.error("Error creating plan:", error);
    if (error && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to create plan",
    });
  }
});
