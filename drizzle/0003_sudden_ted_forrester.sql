CREATE TABLE `user_courses` (
	`user_id` text NOT NULL,
	`course_id` text NOT NULL,
	`role` text DEFAULT 'starred' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `course_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`pace` integer,
	`pace_unit` text DEFAULT 'min_per_km' NOT NULL,
	`pace_mode` text DEFAULT 'pace' NOT NULL,
	`target_time_seconds` integer,
	`default_stoppage_time` integer DEFAULT 0,
	`use_grade_adjustment` integer DEFAULT true NOT NULL,
	`pacing_strategy` text DEFAULT 'flat' NOT NULL,
	`pacing_linear_percent` integer DEFAULT 0,
	`share_enabled` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_plans`("id", "course_id", "user_id", "name", "pace", "pace_unit", "pace_mode", "target_time_seconds", "default_stoppage_time", "use_grade_adjustment", "pacing_strategy", "pacing_linear_percent", "share_enabled", "created_at", "updated_at") SELECT "id", "course_id", "user_id", "name", "pace", "pace_unit", "pace_mode", "target_time_seconds", "default_stoppage_time", "use_grade_adjustment", "pacing_strategy", "pacing_linear_percent", "share_enabled", "created_at", "updated_at" FROM `plans`;--> statement-breakpoint
DROP TABLE `plans`;--> statement-breakpoint
ALTER TABLE `__new_plans` RENAME TO `plans`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `courses` ADD `public` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `courses` ADD `share_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `courses` ADD `forked_from_course_id` text;