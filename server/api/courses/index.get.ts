import { courses, userCourses } from "~/utils/db/schema";
import { cloudDb } from "~~/server/utils/db/cloud";
import { eq, desc } from "drizzle-orm";
import { auth } from "~/utils/auth";

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

    // Get all courses the user has a membership for (owned or legacy added/starred)
    const membershipCourses = await cloudDb
      .select({
        id: courses.id,
        name: courses.name,
        description: courses.description,
        originalFileName: courses.originalFileName,
        fileType: courses.fileType,
        totalDistance: courses.totalDistance,
        elevationGain: courses.elevationGain,
        elevationLoss: courses.elevationLoss,
        raceDate: courses.raceDate,
        createdAt: courses.createdAt,
        updatedAt: courses.updatedAt,
        public: courses.public,
        role: userCourses.role,
      })
      .from(userCourses)
      .innerJoin(courses, eq(userCourses.courseId, courses.id))
      .where(eq(userCourses.userId, session.user.id))
      .orderBy(desc(courses.createdAt));

    // Normalize roles: anything not 'owner' becomes 'starred' (handles legacy 'added')
    const normalized = membershipCourses.map((c) => ({
      ...c,
      role: c.role === "owner" ? "owner" : "starred",
    }));
    const owned = normalized.filter((c) => c.role === "owner");
    const starred = normalized.filter((c) => c.role !== "owner");

    return {
      owned,
      starred,
      courses: normalized, // backward compatibility (was a flat combined list)
      totalOwned: owned.length,
      totalStarred: starred.length,
      total: normalized.length,
    };
  } catch (error) {
    console.error("Error fetching courses:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to fetch courses",
    });
  }
});
