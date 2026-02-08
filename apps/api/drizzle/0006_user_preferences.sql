-- User preferences table (AI config, theme, etc.)
CREATE TABLE IF NOT EXISTS `user_preferences` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`ai_config` text,
	`theme` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS `user_preferences_user_id_unique` ON `user_preferences` (`user_id`);
