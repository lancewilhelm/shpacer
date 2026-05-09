CREATE TABLE `user_course_settings` (
	`user_id` text NOT NULL,
	`course_id` text NOT NULL,
	`settings` text DEFAULT '{}' NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `course_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
INSERT OR IGNORE INTO `user_course_settings` (`user_id`, `course_id`, `settings`, `updated_at`)
SELECT
  `user_settings`.`user_id`,
  `json_each`.`key`,
  `json_each`.`value`,
  `user_settings`.`updated_at`
FROM `user_settings`, json_each(`user_settings`.`settings`, '$.smoothing.perCourse')
WHERE json_valid(`user_settings`.`settings`)
  AND json_type(`user_settings`.`settings`, '$.smoothing.perCourse') = 'object';
