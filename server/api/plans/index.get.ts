import { plans, courses } from "~/utils/db/schema";
import { cloudDb } from "~~/server/utils/db/cloud";
import { eq, desc } from "drizzle-orm";
import { auth } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  const session = await auth.api.getSession({
    headers: event.headers,
  });

  if (!session?.user?.id) {
    throw createError({
      statusCode: 401,
      statusMessage: "Unauthorized",
    });
  }

  const query = getQuery(event);
  const limit =
    typeof query.limit === "string" ? parseInt(query.limit, 10) : 5;

  try {
    const userPlans = await cloudDb
      .select({
        id: plans.id,
        name: plans.name,
        courseId: plans.courseId,
        pace: plans.pace,
        paceUnit: plans.paceUnit,
        targetTimeSeconds: plans.targetTimeSeconds,
        createdAt: plans.createdAt,
        courseName: courses.name,
      })
      .from(plans)
      .innerJoin(courses, eq(plans.courseId, courses.id))
      .where(eq(plans.userId, session.user.id))
      .orderBy(desc(plans.createdAt))
      .limit(limit);

    return { plans: userPlans };
  } catch (error) {
    console.error("Error fetching plans:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to fetch plans",
    });
  }
});
