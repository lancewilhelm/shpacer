-- Add default stoppage time to plans table
ALTER TABLE `plans` ADD `default_stoppage_time` integer DEFAULT 0;

-- Create waypoint stoppage times table for per-waypoint overrides
CREATE TABLE `waypoint_stoppage_times` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`waypoint_id` text NOT NULL,
	`stoppage_time` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`waypoint_id`) REFERENCES `waypoints`(`id`) ON UPDATE no action ON DELETE cascade
);

-- Create unique index to prevent duplicate entries for same plan/waypoint combination
CREATE UNIQUE INDEX `waypoint_stoppage_times_plan_waypoint_unique` ON `waypoint_stoppage_times` (`plan_id`, `waypoint_id`);
