import { eq } from "drizzle-orm";
import { plans } from "~/utils/db/schema";
import { auth } from "~/utils/auth";
import { cloudDb } from "~~/server/utils/db/cloud";

/**
 * PUT /api/plans/:id
 *
 * Updates a plan owned by the authenticated user.
 *
 * Allowed Fields:
 *  - name
 *  - pace
 *  - paceUnit ("min_per_km" | "min_per_mi")
 *  - paceMode ("pace" | "time" | "normalized")
 *  - targetTimeSeconds (number >= 0; only meaningful when paceMode === "time")
 *  - defaultStoppageTime (number >= 0)
 *  - useGradeAdjustment (boolean)
 *  - pacingStrategy ("flat" | "linear")
 *  - pacingLinearPercent (number)
 *  - shareEnabled (boolean)  // Enables/disables public share link (read-only)
 *
 * Ownership Required:
 *  The requester must be the plan owner (plan.userId === session.user.id).
 *
 * Responses:
 *  200 { success: true, plan: { ...updatedPlan } }
 *  400 / 401 / 403 / 404 / 500 errors with statusMessage
 */

interface PlanUpdateRequest {
  name?: string;
  pace?: number | null;
  paceUnit?: "min_per_km" | "min_per_mi";
  paceMode?: "pace" | "time" | "normalized";
  targetTimeSeconds?: number | null;
  defaultStoppageTime?: number | null;
  useGradeAdjustment?: boolean;
  pacingStrategy?: "flat" | "linear";
  pacingLinearPercent?: number | null;
  shareEnabled?: boolean;
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

    const planId = getRouterParam(event, "id");
    if (!planId) {
      throw createError({
        statusCode: 400,
        statusMessage: "Plan ID is required",
      });
    }

    const body = await readBody<PlanUpdateRequest>(event);

    // Fetch plan to verify ownership
    const [existing] = await cloudDb
      .select()
      .from(plans)
      .where(eq(plans.id, planId))
      .limit(1);

    if (!existing) {
      throw createError({
        statusCode: 404,
        statusMessage: "Plan not found",
      });
    }

    if (existing.userId !== session.user.id) {
      throw createError({
        statusCode: 403,
        statusMessage: "Only the owner can modify this plan",
      });
    }

    // Validate enumerations if provided
    if (
      body.paceUnit &&
      body.paceUnit !== "min_per_km" &&
      body.paceUnit !== "min_per_mi"
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid paceUnit",
      });
    }

    if (
      body.paceMode &&
      !["pace", "time", "normalized"].includes(body.paceMode)
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid paceMode",
      });
    }

    if (
      body.pacingStrategy &&
      !["flat", "linear"].includes(body.pacingStrategy)
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid pacingStrategy",
      });
    }

    if (
      body.targetTimeSeconds != null &&
      (typeof body.targetTimeSeconds !== "number" || body.targetTimeSeconds < 0)
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid targetTimeSeconds",
      });
    }

    if (
      body.defaultStoppageTime != null &&
      (typeof body.defaultStoppageTime !== "number" ||
        body.defaultStoppageTime < 0)
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid defaultStoppageTime",
      });
    }

    if (
      body.pace != null &&
      (typeof body.pace !== "number" || body.pace < 0)
    ) {
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid pace",
      });
    }

    // Build update object (only set provided fields)
    const updateData: Partial<typeof plans.$inferSelect> = {
      updatedAt: new Date(),
    };

    if (body.name !== undefined) updateData.name = body.name;
    if (body.pace !== undefined) updateData.pace = body.pace ?? null;
    if (body.paceUnit !== undefined) updateData.paceUnit = body.paceUnit;
    if (body.paceMode !== undefined) updateData.paceMode = body.paceMode;
    if (body.targetTimeSeconds !== undefined)
      updateData.targetTimeSeconds = body.targetTimeSeconds ?? null;
    if (body.defaultStoppageTime !== undefined)
      updateData.defaultStoppageTime = body.defaultStoppageTime ?? 0;
    if (body.useGradeAdjustment !== undefined)
      updateData.useGradeAdjustment = body.useGradeAdjustment;
    if (body.pacingStrategy !== undefined)
      updateData.pacingStrategy = body.pacingStrategy;
    if (body.pacingLinearPercent !== undefined)
      updateData.pacingLinearPercent = body.pacingLinearPercent ?? 0;
    if (body.shareEnabled !== undefined)
      updateData.shareEnabled = body.shareEnabled;

    if (Object.keys(updateData).length === 1) {
      // Only updatedAt present => nothing to change
      return {
        success: true,
        plan: existing,
        unchanged: true,
      };
    }

    const [updated] = await cloudDb
      .update(plans)
      .set(updateData)
      .where(eq(plans.id, planId))
      .returning();

    if (!updated) {
      throw createError({
        statusCode: 500,
        statusMessage: "Failed to update plan",
      });
    }

    return {
      success: true,
      plan: updated,
    };
  } catch (error) {
    if (error && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error("Error updating plan:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to update plan",
    });
  }
});
