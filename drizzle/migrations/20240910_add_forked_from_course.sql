-- Migration: Add forked_from_course_id to courses for fork provenance
-- Date: 2024-09-10
-- Purpose:
--   Adds a nullable self-referencing foreign key column to track the
--   original course a fork was created from.
--   Also adds an index to support provenance queries (e.g., listing forks).
--
-- Notes:
--   ON DELETE SET NULL ensures that if an original course is deleted,
--   forks remain but lose the provenance pointer.

ALTER TABLE `courses`
  ADD `forked_from_course_id` text
    REFERENCES `courses`(`id`)
    ON UPDATE no action
    ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `courses_forked_from_idx`
  ON `courses` (`forked_from_course_id`);
