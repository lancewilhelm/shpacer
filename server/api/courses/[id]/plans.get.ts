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

  if (!courseId) {
    throw createError({
      statusCode: 400,
      statusMessage: "Course ID is required",
    });
  }

  try {
    // Get all plans for this course and user
    const coursePlans = await cloudDb
      .select()
      .from(plans)
      .where(
        and(eq(plans.courseId, courseId), eq(plans.userId, session.user.id)),
      )
      .orderBy(plans.createdAt);

    return {
      plans: coursePlans,
    };
  } catch (error: unknown) {
    console.error("Error fetching plans:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to fetch plans",
    });
  }
});
