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
--> statement-breakpoint
ALTER TABLE `plans` ADD `default_stoppage_time` integer DEFAULT 0 NOT NULL;