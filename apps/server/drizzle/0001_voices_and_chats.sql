CREATE TABLE `dialogue_attributions` (
	`version_id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`narrator_id` text,
	`quotes` text DEFAULT '[]' NOT NULL,
	`source` text DEFAULT 'model' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`version_id`) REFERENCES `generated_versions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `revision_chat_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`chat_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`applied` text DEFAULT '[]' NOT NULL,
	`error` text,
	`run_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `revision_chats`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `revision_chat_messages_chat_idx` ON `revision_chat_messages` (`chat_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `revision_chats` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`scope_type` text NOT NULL,
	`scope_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `revision_chats_scope` ON `revision_chats` (`project_id`,`scope_type`,`scope_id`);--> statement-breakpoint
ALTER TABLE `characters` ADD `voice` text;--> statement-breakpoint
ALTER TABLE `generation_runs` ADD `chat_id` text;