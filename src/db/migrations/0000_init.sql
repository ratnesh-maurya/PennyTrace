CREATE TABLE `account_edits` (
	`account_id` text PRIMARY KEY NOT NULL,
	`patch_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`bank` text NOT NULL,
	`type` text NOT NULL,
	`ownership` text NOT NULL,
	`co_holder` text,
	`mask` text NOT NULL,
	`display_name` text NOT NULL,
	`upi_ids_json` text NOT NULL,
	`aliases_json` text NOT NULL,
	`include_in_total` integer NOT NULL,
	`ord` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `balance_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`account_id` text NOT NULL,
	`at` integer NOT NULL,
	`reported_paise` integer NOT NULL,
	`source_event_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `balance_snapshots_account_at_idx` ON `balance_snapshots` (`account_id`,`at`);--> statement-breakpoint
CREATE TABLE `category_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`pattern` text NOT NULL,
	`field` text NOT NULL,
	`category_id` text NOT NULL,
	`priority` integer NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `category_rules_priority_idx` ON `category_rules` (`priority`);--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_events` (
	`id` text PRIMARY KEY NOT NULL,
	`source_kind` text NOT NULL,
	`external_id` text NOT NULL,
	`sender` text NOT NULL,
	`body` text,
	`fingerprint` text NOT NULL,
	`received_at` integer NOT NULL,
	`parser_id` text,
	`parser_version` integer,
	`parse_status` text NOT NULL,
	`parsed_json` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `source_events_fingerprint_uq` ON `source_events` (`fingerprint`);--> statement-breakpoint
CREATE INDEX `source_events_received_at_idx` ON `source_events` (`received_at`);--> statement-breakpoint
CREATE INDEX `source_events_status_idx` ON `source_events` (`parse_status`);--> statement-breakpoint
CREATE TABLE `transaction_sources` (
	`txn_id` text NOT NULL,
	`source_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`txn_id`, `source_id`)
);
--> statement-breakpoint
CREATE INDEX `transaction_sources_source_idx` ON `transaction_sources` (`source_id`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`stable_key` text NOT NULL,
	`account_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`direction` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`status` text NOT NULL,
	`kind` text NOT NULL,
	`counterparty` text,
	`vpa` text,
	`category_id` text NOT NULL,
	`confidence` integer NOT NULL,
	`rule_provenance` text NOT NULL,
	`needs_review` integer NOT NULL,
	`ref_upi` text,
	`ref_utr` text,
	`ref_other` text,
	`merge_reason` text,
	`linked_txn_id` text,
	`parser_id` text NOT NULL,
	`ord` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `transactions_stable_key_idx` ON `transactions` (`stable_key`);--> statement-breakpoint
CREATE INDEX `transactions_account_time_idx` ON `transactions` (`account_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `transactions_occurred_at_idx` ON `transactions` (`occurred_at`);--> statement-breakpoint
CREATE INDEX `transactions_review_idx` ON `transactions` (`needs_review`);--> statement-breakpoint
CREATE INDEX `transactions_ref_upi_idx` ON `transactions` (`ref_upi`);--> statement-breakpoint
CREATE INDEX `transactions_ref_utr_idx` ON `transactions` (`ref_utr`);--> statement-breakpoint
CREATE TABLE `transfer_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`debit_txn_id` text NOT NULL,
	`credit_txn_id` text,
	`method` text NOT NULL,
	`state` text NOT NULL,
	`confidence` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `transfer_links_debit_idx` ON `transfer_links` (`debit_txn_id`);--> statement-breakpoint
CREATE INDEX `transfer_links_credit_idx` ON `transfer_links` (`credit_txn_id`);--> statement-breakpoint
CREATE TABLE `user_overrides` (
	`stable_key` text PRIMARY KEY NOT NULL,
	`patch_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
