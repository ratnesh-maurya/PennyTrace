# PennyTrace — Build Plan

## Context

PennyTrace is an open-source Android app. It builds a personal ledger automatically from bank and UPI SMS:
- No manual entry, no backend, no cloud, no analytics.
- Parsing, the database, categorization and LLM inference all run on the device.
- Email and notification-listener sources are out of scope for v1.

What the user needs:
- Track every transaction, categorize it, and name the counterparty.
- A **daily close** per account and across all accounts: opening, in, spent, moved, closing.
- Self-transfers count as neither income nor spending.
- Two SMS for the same transaction are never counted twice.

Decisions already made:
- **Single APK.** It holds INTERNET, but the only network use is a model download the user starts by tapping. Code and network security config restrict this (§7).
- **The LLM does four jobs:** parse SMS no regex parser handles, categorize and name, write the daily summary text, and chat with the ledger.
- **UI** comes from Claude Design project `5134310b-…`: `Ledger Showcase v2.dc.html` renders `LedgerApp2.dc.html` (7 screens, light and dark themes). It has been imported and its spec extracted (§3).
- **Stack:** React Native CLI (bare), TypeScript, New Architecture. Scaffolded with `@react-native-community/cli@20.2.0 init` on RN **0.87.1**. Android only, so the `ios/` folder was removed.
- **SMS samples:** the user will provide real samples, which are added as anonymised golden fixtures.
- **Licence:** AGPL-3.0, crediting pennywiseai-tracker (§0).

## 0. Licensing (decided)

PennyTrace is licensed **AGPL-3.0-or-later** (`LICENSE`).

Parser logic, the transaction-filtering rules and the dedupe approach are ported to TypeScript from
[sarim2000/pennywiseai-tracker](https://github.com/sarim2000/pennywiseai-tracker) (AGPL-3.0).

The project credits them as follows:
- `NOTICE.md` gives them primary credit.
- Every ported file carries a `Ported from pennywiseai-tracker …` header.
- We never use the "PennyWise" name or logo, per their TRADEMARKS.md.

## 1. Stack

| Concern | Choice |
|---|---|
| App | RN CLI (latest stable 0.8x), TS strict, New Arch, Hermes, `minSdk 26` |
| Navigation | `@react-navigation/native` + bottom-tabs (5 tabs) + native-stack (detail overlay, sheets) |
| DB | `@op-engineering/op-sqlite` with `sqlcipher: true`, `drizzle-orm` + `drizzle-kit` migrations, reactive queries |
| DB key | random 256-bit key held by `react-native-keychain` (Android Keystore) |
| UI state | `zustand`: selected day, scope, filter, range, toast |
| SMS | **custom Kotlin TurboModule** `PennySms`. `react-native-get-sms-android` is dead and uses the old bridge. |
| LLM | `llama.rn` (GGUF, `response_format: json_schema` → GBNF constrained decoding) |
| Model | Qwen3-0.6B Q4_K_M (~0.45 GB, Apache-2.0). Optional: Qwen3.5-0.8B Q4 (~0.58 GB). Avoid Gemma and Llama because of their licences. |
| Model download | `@kesha-antonov/react-native-background-downloader` (Range resume) + `@dr.pogodin/react-native-fs` (sha256, move) |
| Notifications | small Kotlin `PennyNotify` module (AlarmManager + NotificationManager). notifee is unmaintained (last release 2024-12). |
| Visuals | `react-native-linear-gradient` (hero), `react-native-svg` (donut, waterfall, bars), bundled **Geist / Geist Mono** (OFL) and a **Material Symbols Rounded** subset font. No Google Fonts fetch at runtime. |
| Tests | Jest (pure-TS core in Node), React Native Testing Library |

Banned: Firebase, Sentry, analytics, axios, remote config, and anything else that phones home.

## 2. Repo layout

```
android/app/src/main/java/.../sms/   PennySmsModule.kt, SmsReceiver.kt, ScanWorker.kt
android/app/src/main/res/xml/        network_security_config.xml, data_extraction_rules.xml
src/
  core/            PURE TS (lint rule: no react-native imports) — runs in Jest/Node
    money.ts, time.ts
    sms/filter.ts, sms/fingerprint.ts
    parsers/{types,registry,helpers,generic}.ts, parsers/banks/<bank>.ts   (versioned ids e.g. "hdfc-upi-debit v1")
    ledger/{dedupe,accounts,transfers,categorize,reconcile,dailyClose,insights}.ts
    pipeline.ts
  db/              schema.ts, migrations/, repo/*.ts, key.ts
  native/          PennySms.ts (codegen spec)
  llm/             modelManager.ts, download.ts (ONLY network file), tasks/{parseFallback,categorize,summary,chat}.ts, schemas/
  ui/              theme/ (tokens §3.1), primitives (Card, Chip, Tile, Pill, Toast, Sheet, Switch, Icon), charts/
  features/        today/, review/, activity/, detail/, insights/, accounts/, privacy/, onboarding/, model/, chat/
fixtures/sms/<bank>/*.json   anonymised sample + expected ParsedEvent (golden tests)
scripts/anonymize-sms.ts     masks names/acct digits/refs/VPAs before a sample enters the repo
design/                      imported .dc.html files (reference only)
```

## 3. UI: port of LedgerApp2

### 3.1 Tokens (`src/ui/theme/`)
- **Light and dark palettes are copied exactly:**
  - Surfaces: bg `#F4F6FB` / `#060A14`, surface, surface2, sheet.
  - Text: ink, ink2, ink3.
  - Lines: line, line2.
  - Status pairs, each with a soft variant: pos, out, warn, xfer.
  - Chrome: navBg, toast, barSoft.
  - Shadow: light uses a soft shadow (elevation 2); dark uses a 1px `rgba(255,255,255,0.045)` hairline instead.
- **Accents:** blue (default) `#1E5EFF` / `#5B8EFF`, plus sky and violet. Each has accentSoft, accentInk, a 3-stop hero gradient at 140° and a heroShadow.
  - The showcase lists green, indigo and saffron, but they are not defined anywhere and fall back to blue.
- **Category palette:** each category gets an icon and colour (Food `#FF6B2C`, Travel `#00A6FB`, …). The soft tint is the same colour at 14% alpha.
  - Brand tile colours for known banks and merchants (HDFC `#004C8F`, SBI `#1E3F8F`, …). Unknown names get a deterministic colour from a hash of the name.
- **Type scale:** 40, 38, 34, 32, 26 titles, 20, 18, 17, 16, 15, 14, 13.5, 13, 12.5, 12, 11.5, 11 eyebrow, 10.5, 10, 9.5. Exact weights and tracking come from the spec.
  - All numbers use `tabular-nums`.
  - Raw SMS, refs and parser ids use Geist Mono.
- **Radii:** 30 sheet, 28 hero, 26 / 24 / 22 cards, 20 strip and stat, 18, 16 … 3.
- **Spacing:** screen padding `6 18 24`, section gap 14, card padding 16.
- **Formatting helpers:** `en-IN` grouping, `₹`, a real minus sign `−` (U+2212), masked `••1234`.

### 3.2 Navigation
Bottom bar in Material 3 style with a 56×32 pill:
- **Today, Activity, Insights, Accounts, Privacy.**
- Activity shows a warn-coloured dot when any transaction needs review.

The detail overlay opens from an Activity row. The correction sheet opens from the Today Quick Check, from "Change" in Detail, and from the Review filter. The toast appears 100px from the bottom and lasts 2.6 s.

### 3.3 Screens, components and the data they need

| Screen | Components | Backed by |
|---|---|---|
| **Today: Daily close** | TopRow (date, TODAY badge, "On-device" pill), WeekStrip (7 days, dot colour = spend intensity), AccountScopeChips, CloseHeroCard (closing balance, ReconBadge, CloseWaterfall: open, in, spent, moved, close), StatTriplet (Received, Spent, Moved), XferNote, QuickCheckCard (lowest-confidence item still needing review), WhereItWentCard (stacked CategoryBar + rows), AccountsCard (balance + status, card shown as a liability, "Reconcile" link) | `dailyClose(day, scope)`, `reviewQueue()`, `accountsStatus()` |
| **Quick correction** (sheet) | Header (tile, "What was this?", meta line), CategoryOptionGrid (2 columns, including "Not an expense"), RememberRow ("Always use this for {MERCHANT}", "Saved as an on-device rule", on by default), Save | writes `user_overrides` + `category_rules(source=user)`. Confidence becomes 100. Toast. |
| **Activity** | Title + tune, SearchField (merchants, people, refs), FilterChips with counts (All / Spent / Received / Moves / Review), DayGroups with the day's spent total, TransactionRow (tile, name, StatusBadge: Review / Matched / In transit / Not spending / To cash / Refund, "{cat} · {time}", signed and coloured amount, SourceIcons), EmptyState | `transactions` query with FTS on counterparty + refs |
| **Detail: evidence** | Header (tile, name, 38px amount, date · time · account), CategoryCard (rule provenance, ConfidenceChip ≥90 / 75–89 / <75, ConfidenceBar), EvidenceTimeline ("{n} alerts → 1 transaction", raw text in mono), MatchCallout (why the alerts were merged or linked), MetaCard (Reference, Parser), actions "Change category" and "Mark as transfer" (**implement this**; it is a stub in the design) | `transaction_sources` → `source_events`, `merge_reason`, `parser_id` |
| **Insights** | RangeSegment (Week / Month), AccountChips (All plus each account, joint accounts included), SpendHeroCard (total, avg per day or week, DeltaPill vs the previous period, SpendBarChart with an average line; tapping a bar sets the shared selected day), StatPair (Money in, "Kept of money in" %), ByAccountCard, CategoriesCard (SVG donut), TopMerchantsCard (fix the hard-coded "this week" copy) | `insights(range, scope)` |
| **Accounts: Reconciliation** | PositionCard (inverted colours: full position = cash − card dues), one ReconCard per account (StatusChip "Reconciled" or "Off by ₹X", VarianceGrid Calculated / Bank says / Variance, note with the last report time), "Own-account transfers" section with TransferPairCard (matched by UTR, or in transit with a dashed line) | `reconcile()`, `transfer_links` |
| **Privacy** | PrivacyHero, GuaranteeList, Sources toggles, Import / Export tiles, footer | settings + live counts ("N messages read · M banks recognised") |

Added screens that the design doesn't include, built in the same visual language:
- **Onboarding:** permission rationale, scan depth, initial-scan progress.
- **AI model:** download, size, Wi-Fi only, verify, delete.
- **Chat:** reached from Insights or Today.
- **Needs-parsing list:** SMS that no parser or the LLM could read.
- **Account edit:** rename, own or joint, co-holder, include in total, UPI IDs and aliases.

### 3.4 Places where the design contradicts our decisions (copy changes)
- **The Privacy hero says "doesn't request internet access."** That is false with a single APK. New copy:
  - Hero: "Nothing leaves this phone. Internet is used for one thing only: downloading the AI model when you tap Download."
  - Guarantee row: "Internet: model download only."
- **"Email notifications" source:** shown disabled with "Coming later". Not built in v1.
- **Evidence sources:** v1 uses only `sms`. The schema keeps `source_kind` open for notifications and mail later.

## 4. Native layer (Kotlin)
- **`PennySmsModule`** (TurboModule):
  - `checkPermission` / `requestPermission` for READ_SMS and RECEIVE_SMS only.
  - `queryInbox({afterId, sinceMs, limit})` reads `Telephony.Sms.Inbox.CONTENT_URI` and returns `{id, address, body, date}`.
  - `getMaxId`.
- **`SmsReceiver`** (`SMS_RECEIVED`) only wakes the app. It emits an event when the app is alive; otherwise it enqueues a WorkManager job, delayed about 3 s, that starts a `HeadlessJsTaskService` to run an incremental scan.
- **The inbox is the durable queue.** We persist `last_scanned_sms_id` and scan `_id > last`. Process death, missed broadcasts and reboots are recovered on the next scan or app open.
- **First run:** back-scan N months (default 6) in batches of 500, with progress shown.
- **Manifest:**
  - `allowBackup=false` and `dataExtractionRules` excluding everything.
  - `networkSecurityConfig`: cleartext off, HTTPS allowed only to `huggingface.co` and its CDN redirect hosts. Verify the redirect hosts during implementation.

## 5. Data model (drizzle) and pipeline

Money is stored as integer **paise**. Times are epoch ms; day buckets use the device time zone.

- `source_events`: `id, source_kind, external_id, sender, body_enc, fingerprint UNIQUE, received_at, parser_id, parser_version, parse_status(parsed|ignored|unparsed|llm|needs_review), parsed_json`
- `accounts`: `id, bank, type(savings|current|credit_card|wallet|cash), ownership(personal|joint), co_holder, mask, display_name, brand_color, upi_ids, aliases, include_in_total`
- `transactions`:
  - Core fields: `id, stable_key, account_id, amount_paise, direction, occurred_at, status(pending|success|failed|reversed)`.
  - `kind(spend|in|xfer|pending_xfer|refund|liability|cash|fee)`, matching the UI's kinds.
  - Counterparty and category: `counterparty_id, category_id, confidence, rule_provenance, needs_review`.
  - References: `ref_upi, ref_utr, ref_other, merge_reason, linked_txn_id`.
- `transaction_sources`, `transfer_links(debit_id, credit_id, method, state matched|in_transit)`, `balance_snapshots(account_id, at, reported_paise, source_event_id)`
- `counterparties(display_name, type merchant|person|biller|own, vpa, aliases)`, `categories` (seeded from the design palette plus Fuel, Health, EMI, Investments, Salary, Fees, Other), `category_rules(pattern, field, category_id, priority, source seed|user|llm)`, `user_overrides(stable_key, patch)`, `meta`

**Rebuild invariant.** `transactions` and `transfer_links` are *derived* from `source_events` + `user_overrides`. When a parser version is bumped, everything is reprocessed and the overrides replayed. Processing the same input again never changes the ledger.

**Pipeline** (`core/pipeline.ts`):
1. **Gate:** keep DLT `-S`/`-T` and known bank senders. Drop `-P`/`-G`, OTPs, promos, payment requests and due reminders. Statement and balance-only SMS produce snapshots only.
2. **Fingerprint:** sha256 of the normalised sender + body. A known fingerprint means a no-op.
3. **Parse:** bank parser via the registry, then `generic`, then LLM fallback (queued). Otherwise the SMS is marked `unparsed`.
4. **Dedupe:**
   1. Same UPI ref, UTR or RRN + amount + account → attach as another source.
   2. Same account, amount and direction within ±10 min, only when both lack refs **and** come from different senders or templates.
   3. Same template and same amount are never merged: two ₹500 purchases are real.
   4. Lifecycle: pending → success updates the transaction. Failed or reversed changes its status. A refund is a new transaction linked to the original.
5. **Account resolve:** bank + last-4 mask, created automatically and editable.
6. **Transfers:**
   - Own A debit ↔ own B credit, matched by shared ref, then by equal amount within 72 h, then by an own VPA or alias → `xfer`.
   - A debit to an own alias with no credit yet → `pending_xfer` ("in transit"), excluded from spending.
   - Card bill payment → `liability`. ATM → `cash`.
7. **Categorize:** override → counterparty alias → rules → LLM if low confidence → Other.
   - Confidence below 75 → `needs_review`, which feeds the Quick check and the Review filter.
8. **Reconcile:** `variance = reported − calculated`. Variance is shown and never auto-corrected.

**Daily close** (`ledger/dailyClose.ts`), per account and day:
- `opening` = previous closing, anchored to the nearest snapshot; marked `estimated` if there is no anchor.
- `in` = credits excluding xfer and refund.
- `spent` = spend + fee.
- `moved` = xfer + liability + cash.
- `closing`, compared against the reported balance.

The "All" scope sums accounts with `include_in_total`. Cards are shown separately as liabilities. Joint accounts are excluded from the total by default and analysable on their own.

## 6. On-device LLM (`src/llm/`)
- **Model manager:**
  - Catalog of HF URLs pinned to a commit, with byte size, SHA-256 and licence.
  - Download is explicit, Wi-Fi only by default. It writes a `.part` file, verifies the SHA-256, then moves it to `filesDir/models/`.
  - Load lazily. Unload when the app is backgrounded or under memory pressure.
- **Every task** uses JSON-schema-constrained decoding at temperature 0.
  1. **parseFallback:** produces `{is_txn, amount, direction, account_mask, counterparty, ref, balance, status}`.
     - Code validates the result: the amount and mask must appear literally in the body, or the result is rejected.
     - Accepted results are tagged `llm` with confidence ≤ 70, so they go to review.
  2. **categorize:** produces `{clean_name, counterparty_type, category_id (enum)}`. Batched in the background.
  3. **summary:** turns numbers that code already computed into 2–3 sentences. If the output contains a number not present in the input, a fixed template is used instead.
  4. **chat:**
     - The question is converted to a constrained **query intent** `{metric, range, accounts, categories, counterparty, groupBy}`.
     - Typed repo functions run that intent. The LLM never writes SQL.
     - The result is phrased like the summary task and also shown as a table or chart built from real numbers.
- **Learn templates:** once the user confirms an LLM parse, its digits and amounts are masked into a user parser rule, so later SMS from that sender skip the LLM.
- Without a model the app is fully functional. LLM features show a "Download model" call to action.

## 7. Privacy enforcement
- **ESLint** bans `fetch`, `XMLHttpRequest` and `WebSocket` everywhere except `src/llm/download.ts`.
- **Network security config** allows only HF hosts and disables cleartext.
- **CI** runs `aapt dump permissions` on the release APK against an allowlist: INTERNET, READ_SMS, RECEIVE_SMS, POST_NOTIFICATIONS, RECEIVE_BOOT_COMPLETED, WAKE_LOCK, FOREGROUND_SERVICE_DATA_SYNC. Removals use `tools:node="remove"`. A dependency denylist check also runs.
- **Storage:**
  - The release build strips `console.*`.
  - Raw bodies are encrypted at rest. The "Discard raw messages" toggle purges them after parsing.
- **Other:** optional biometric lock. Export and import go through the SAF file picker only, as an encrypted JSON file.
- **README:** explains how to verify all of this yourself (aapt, mitmproxy, GrapheneOS Network toggle).

## 8. Phases
0. **Bootstrap.**
   - `npx @react-native-community/cli init` with the TS template, plus lint, Jest, licence, README and CONTRIBUTING ("add a bank parser" guide).
   - Copy the design files into `design/`.
   - Build the theme tokens, primitives, fonts and icon font, plus a static mock-data version of all 7 screens matching the design in light and dark.
1. **Ledger core.**
   - Intake of the user's SMS samples, anonymised with `scripts/anonymize-sms.ts` (the repo is public).
   - Gate, fingerprint, generic parser plus bank parsers for the banks in the samples, golden fixtures.
   - DB with SQLCipher, migrations, the PennySms module, receiver and scans, onboarding.
2. **Intelligence:** dedupe and lifecycle, accounts, transfers / card bills / ATM, category rules and seed merchant aliases, reconciliation, overrides and rebuild.
3. **Wire screens to real data.** Correction sheet writing rules, Mark-as-transfer, search, insights, daily notification.
4. **LLM:** model screen and download, parseFallback, categorize, summary, chat, learned templates.
5. **Release.** Encrypted backup, app lock, permission CI, performance test with 50k SMS, Play SMS-permission declaration (expense-tracking exception) and F-Droid metadata (build llama.rn from source).

## 9. Verification
- **`yarn test`:**
  - Per-bank golden fixtures.
  - Scenario tests, each asserting the daily-close numbers:
    - duplicate SMS
    - two genuine ₹500 purchases
    - pending → success
    - self-transfer whose credit arrives 5 h later
    - card bill payment
    - ATM withdrawal
    - refund and reversal
    - SMS with no reference
    - a variance case
  - Property test: shuffled order or a rescan produces an identical ledger.
- **Device:**
  - `adb emu sms send <sender> "<body>"`: the transaction appears live.
  - Kill the app, send an SMS, reopen: the SMS is recovered.
  - The same holds across a reboot.
  - Screens checked against the design in light and dark, side by side.
- **Privacy:**
  - `aapt dump permissions` on the release APK.
  - Airplane mode: everything except the download still works.
  - mitmproxy over a full session: the only traffic is to HF hosts, during the download.
- **LLM:** an eval script runs parseFallback over the fixtures with the parsers disabled and reports field accuracy and rejection rate. Also measure tokens per second on a mid-range device.
