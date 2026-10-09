# NOTICE

PennyTrace
Copyright (C) 2026 Ratnesh Maurya and PennyTrace contributors

This program is free software: you can redistribute it and/or modify it under the terms of the
GNU Affero General Public License as published by the Free Software Foundation, either version 3
of the License, or (at your option) any later version. See [`LICENSE`](LICENSE).

## Primary credit: pennywiseai-tracker

PennyTrace is built on the work of
**[pennywiseai-tracker](https://github.com/sarim2000/pennywiseai-tracker)** by Sarim and its
contributors, licensed under the GNU AGPL-3.0.

The following were ported to TypeScript from that project's Kotlin sources, and modified:

- **Bank SMS parsers.** This covers the base parser structure, the bank-specific regex patterns,
  the shared compiled patterns, merchant-name cleaning, and the checks for whether a message is a
  transaction or not (OTP, promotional, payment request, due reminder) (`parser-core`).
- **Sender filtering.** This includes DLT suffix handling (`-S`/`-T` kept, `-P`/`-G` dropped) and
  the ordered parser registry.
- **Merchant → category keyword map.** Ported from `SharedCategoryMapping.kt`, trimmed to India and extended (`src/core/ledger/seedRules.ts`).
- **Deduplication.** The ideas used are a transaction hash built from the message body, and UPI
  reference matching within a time window.

Every ported file says so in its header and records what changed. All modifications are released
under the same AGPL-3.0 licence.

"PennyWise" and the PennyWise logo are trademarks of the upstream project. PennyTrace is a
separate project and does not use them.

## Bundled third-party assets

| Asset | License |
|---|---|
| Geist and Geist Mono fonts (Vercel) | SIL Open Font License 1.1 (`assets/fonts/OFL-Geist.txt`) |
| Material Symbols (Google), via `@material-symbols/svg-400` | Apache-2.0 |

## On-device models (downloaded only when the user asks)

| Model | License |
|---|---|
| Qwen3-0.6B, Q4_K_M GGUF quantised by unsloth (default) | Apache-2.0 |
| Qwen3.5-0.8B, Q4_K_M GGUF quantised by unsloth (optional) | Apache-2.0 |
