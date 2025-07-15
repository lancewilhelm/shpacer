import { courses } from "~/utils/db/schema";
import { cloudDb } from "~~/server/utils/db/cloud";
import { eq } from "drizzle-orm";
import { auth } from "~/utils/auth";

export default defineEventHandler(async (event) => {
  try {
    const session = await auth.api.getSession({
      headers: event.headers,
    });
    
    if (!session?.user?.id) {
      throw createError({
        statusCode: 401,
        statusMessage: "Unauthorized"
      });
    }

    const courseId = getRouterParam(event, 'id');
    
    if (!courseId) {
      throw createError({
        statusCode: 400,
        statusMessage: "Course ID is required"
      });
    }

    // Get the course
    const [course] = await cloudDb
      .select({
        originalFileName: courses.originalFileName,
        originalFileContent: courses.originalFileContent,
        fileType: courses.fileType,
        userId: courses.userId,
      })
      .from(courses)
      .where(eq(courses.id, courseId))
      .limit(1);

    if (!course) {
      throw createError({
        statusCode: 404,
        statusMessage: "Course not found"
      });
    }

    // Check if user owns this course
    if (course.userId !== session.user.id) {
      throw createError({
        statusCode: 403,
        statusMessage: "Access denied"
      });
    }

    // Set appropriate headers for file download
    const contentType = course.fileType === 'gpx' ? 'application/gpx+xml' : 'application/vnd.garmin.tcx+xml';
    
    setHeader(event, 'Content-Type', contentType);
    setHeader(event, 'Content-Disposition', `attachment; filename="${course.originalFileName}"`);
    
    return course.originalFileContent;
  } catch (error) {
    console.error("Error downloading course file:", error);
    throw createError({
      statusCode: 500,
      statusMessage: "Failed to download course file"
    });
  }
});
