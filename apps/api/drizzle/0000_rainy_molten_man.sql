CREATE TABLE `entries` (
	`id` text PRIMARY KEY NOT NULL,
	`date` text NOT NULL,
	`content` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entries_date_unique` ON `entries` (`date`);