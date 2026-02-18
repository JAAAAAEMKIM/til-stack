PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`content` text NOT NULL,
	`user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_entries`("id", "date", "content", "user_id", "created_at", "updated_at") SELECT "id", "date", "content", NULL, "created_at", "updated_at" FROM `entries`;--> statement-breakpoint
DROP TABLE `entries`;--> statement-breakpoint
ALTER TABLE `__new_entries` RENAME TO `entries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `entries_date_user_idx` ON `entries` (`date`,`user_id`);--> statement-breakpoint
CREATE TABLE `__new_skip_days` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`value` text NOT NULL,
	`user_id` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_skip_days`("id", "type", "value", "user_id", "created_at") SELECT "id", "type", "value", NULL, "created_at" FROM `skip_days`;--> statement-breakpoint
DROP TABLE `skip_days`;--> statement-breakpoint
ALTER TABLE `__new_skip_days` RENAME TO `skip_days`;--> statement-breakpoint
CREATE TABLE `__new_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`content` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_templates`("id", "name", "content", "is_default", "user_id", "created_at", "updated_at") SELECT "id", "name", "content", "is_default", NULL, "created_at", "updated_at" FROM `templates`;--> statement-breakpoint
DROP TABLE `templates`;--> statement-breakpoint
ALTER TABLE `__new_templates` RENAME TO `templates`;--> statement-breakpoint
CREATE TABLE `__new_webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`message` text DEFAULT '⏰ Time to write your TIL!' NOT NULL,
	`time` text NOT NULL,
	`days` text NOT NULL,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`user_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_webhooks`("id", "name", "url", "message", "time", "days", "timezone", "enabled", "user_id", "created_at", "updated_at") SELECT "id", "name", "url", "message", "time", "days", "timezone", "enabled", NULL, "created_at", "updated_at" FROM `webhooks`;--> statement-breakpoint
DROP TABLE `webhooks`;--> statement-breakpoint
ALTER TABLE `__new_webhooks` RENAME TO `webhooks`;