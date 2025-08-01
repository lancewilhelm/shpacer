import { eq, and } from "drizzle-orm";
import { plans } from "~/utils/db/schema";
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

  try {
    // Verify the plan exists and belongs to the user
    const existingPlan = await cloudDb
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

    if (existingPlan.length === 0) {
      throw createError({
        statusCode: 404,
        statusMessage: "Plan not found",
      });
    }

    // Prepare update data
    const updateData: Partial<typeof plans.$inferInsert> = {
      updatedAt: new Date(),
    };

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.trim() === "") {
        throw createError({
          statusCode: 400,
          statusMessage: "Plan name must be a non-empty string",
        });
      }
      updateData.name = body.name.trim();
    }

    if (body.pace !== undefined) {
      updateData.pace = body.pace;
    }

    if (body.paceUnit !== undefined) {
      if (!["min_per_km", "min_per_mi"].includes(body.paceUnit)) {
        throw createError({
          statusCode: 400,
          statusMessage: "Invalid pace unit",
        });
      }
      updateData.paceUnit = body.paceUnit;
    }

    if (body.defaultStoppageTime !== undefined) {
      if (
        typeof body.defaultStoppageTime !== "number" ||
        body.defaultStoppageTime < 0
      ) {
        throw createError({
          statusCode: 400,
          statusMessage: "Default stoppage time must be a non-negative number",
        });
      }
      updateData.defaultStoppageTime = body.defaultStoppageTime;
    }

    // Update the plan
    const updatedPlan = await cloudDb
      .update(plans)
      .set(updateData)
      .where(eq(plans.id, planId))
      .returning();

    return {
      plan: updatedPlan[0],
    };
  } catch (error: unknown) {
    console.error("Error updating plan:", error);
    if (error && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to update plan",
    });
  }
});
