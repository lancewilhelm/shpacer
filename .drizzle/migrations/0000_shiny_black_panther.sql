CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`user_id` text NOT NULL,
	`original_file_name` text NOT NULL,
	`original_file_content` text NOT NULL,
	`file_type` text NOT NULL,
	`geojson_data` text NOT NULL,
	`total_distance` integer,
	`elevation_gain` integer,
	`elevation_loss` integer,
	`race_date` integer,
	`public` integer DEFAULT false NOT NULL,
	`share_enabled` integer DEFAULT false NOT NULL,
	`forked_from_course_id` text,
	`default_distance_unit` text DEFAULT 'miles' NOT NULL,
	`default_elevation_unit` text DEFAULT 'feet' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `global_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `knowledge` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`documents` integer NOT NULL,
	`chunks` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `knowledge_name_unique` ON `knowledge` (`name`);--> statement-breakpoint
CREATE TABLE `plans` (
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
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`impersonated_by` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_unique` ON `sessions` (`token`);--> statement-breakpoint
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
CREATE TABLE `user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_settings_user_id_unique` ON `user_settings` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`role` text NOT NULL,
	`banned` integer,
	`ban_reason` text,
	`ban_expires` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `verifications` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `waypoint_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`waypoint_id` text NOT NULL,
	`user_id` text NOT NULL,
	`notes` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`waypoint_id`) REFERENCES `waypoints`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
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
CREATE TABLE `waypoints` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`lat` text NOT NULL,
	`lng` text NOT NULL,
	`elevation` integer,
	`distance` integer NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`icon` text,
	`order` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
