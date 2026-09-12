CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chapters` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`plot_point_ids` text DEFAULT '[]' NOT NULL,
	`current_version_id` text,
	`stale_level` text DEFAULT 'none' NOT NULL,
	`stale_reasons` text DEFAULT '[]' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `chapters_project_idx` ON `chapters` (`project_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `character_experiences` (
	`id` text PRIMARY KEY NOT NULL,
	`character_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`when_label` text,
	`title` text NOT NULL,
	`description` text,
	`impact` text,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `character_experiences_character_idx` ON `character_experiences` (`character_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `character_relationships` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`from_character_id` text NOT NULL,
	`to_character_id` text NOT NULL,
	`kind` text NOT NULL,
	`description` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`from_character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `character_relationships_project_idx` ON `character_relationships` (`project_id`);--> statement-breakpoint
CREATE TABLE `characters` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`role` text DEFAULT 'supporting' NOT NULL,
	`description` text,
	`appearance` text,
	`personality` text,
	`backstory` text,
	`arc_notes` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `characters_project_idx` ON `characters` (`project_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `entity_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`revision` integer NOT NULL,
	`snapshot` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`deleted` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `entity_revisions_unique` ON `entity_revisions` (`entity_type`,`entity_id`,`revision`);--> statement-breakpoint
CREATE INDEX `entity_revisions_entity_idx` ON `entity_revisions` (`entity_type`,`entity_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `generated_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`run_id` text,
	`version_no` integer NOT NULL,
	`content` text NOT NULL,
	`word_count` integer DEFAULT 0 NOT NULL,
	`instructions` text,
	`parent_version_id` text,
	`bible_hash` text,
	`stop_reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generated_versions_target_no` ON `generated_versions` (`target_type`,`target_id`,`version_no`);--> statement-breakpoint
CREATE INDEX `generated_versions_target_idx` ON `generated_versions` (`target_type`,`target_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `generated_versions_project_idx` ON `generated_versions` (`project_id`);--> statement-breakpoint
CREATE TABLE `generation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`mode` text NOT NULL,
	`kind` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`effort` text NOT NULL,
	`instructions` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`bible_markdown` text,
	`bible_hash` text,
	`estimated_input_tokens` integer,
	`input_tokens` integer,
	`output_tokens` integer,
	`cache_read_tokens` integer,
	`error` text,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `generation_runs_project_idx` ON `generation_runs` (`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `idea_links` (
	`id` text PRIMARY KEY NOT NULL,
	`idea_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`note` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`idea_id`) REFERENCES `ideas`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idea_links_unique` ON `idea_links` (`idea_id`,`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `idea_links_entity_idx` ON `idea_links` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `ideas` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`text` text NOT NULL,
	`status` text DEFAULT 'inbox' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ideas_project_status_idx` ON `ideas` (`project_id`,`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `locations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`sensory_details` text,
	`rules_lore` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `locations_project_idx` ON `locations` (`project_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `plot_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`kind` text DEFAULT 'main' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plot_lines_project_idx` ON `plot_lines` (`project_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `plot_point_characters` (
	`plot_point_id` text NOT NULL,
	`character_id` text NOT NULL,
	PRIMARY KEY(`plot_point_id`, `character_id`),
	FOREIGN KEY (`plot_point_id`) REFERENCES `plot_points`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`character_id`) REFERENCES `characters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `plot_point_locations` (
	`plot_point_id` text NOT NULL,
	`location_id` text NOT NULL,
	PRIMARY KEY(`plot_point_id`, `location_id`),
	FOREIGN KEY (`plot_point_id`) REFERENCES `plot_points`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`location_id`) REFERENCES `locations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `plot_points` (
	`id` text PRIMARY KEY NOT NULL,
	`plot_line_id` text NOT NULL,
	`project_id` text NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`status` text DEFAULT 'idea' NOT NULL,
	`notes` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`plot_line_id`) REFERENCES `plot_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plot_points_line_idx` ON `plot_points` (`plot_line_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `plot_points_project_idx` ON `plot_points` (`project_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`provider` text,
	`model` text,
	`effort` text,
	`token_budget` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scenes` (
	`id` text PRIMARY KEY NOT NULL,
	`chapter_id` text NOT NULL,
	`project_id` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`title` text NOT NULL,
	`summary` text,
	`goal` text,
	`pov_character_id` text,
	`location_id` text,
	`plot_point_ids` text DEFAULT '[]' NOT NULL,
	`current_version_id` text,
	`stale_level` text DEFAULT 'none' NOT NULL,
	`stale_reasons` text DEFAULT '[]' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `scenes_chapter_idx` ON `scenes` (`chapter_id`,`sort_order`);--> statement-breakpoint
CREATE INDEX `scenes_project_idx` ON `scenes` (`project_id`);--> statement-breakpoint
CREATE TABLE `story_parameters` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`audience` text,
	`target_length_words` integer,
	`genre` text,
	`tone` text,
	`pov` text,
	`tense` text,
	`style_notes` text,
	`content_guidelines` text,
	`comparable_titles` text DEFAULT '[]' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `story_parameters_project_id_unique` ON `story_parameters` (`project_id`);--> statement-breakpoint
CREATE TABLE `version_entity_refs` (
	`version_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`entity_revision` integer NOT NULL,
	`focus` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`version_id`, `entity_type`, `entity_id`),
	FOREIGN KEY (`version_id`) REFERENCES `generated_versions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `version_entity_refs_entity_idx` ON `version_entity_refs` (`entity_type`,`entity_id`);