ALTER TABLE `accounts` ADD `credit_limit_paise` integer;--> statement-breakpoint
ALTER TABLE `accounts` ADD `ignored` integer DEFAULT false NOT NULL;