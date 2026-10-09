# Contributing to PennyTrace

Thanks for helping. Two rules come before everything else:

1. **Never commit real SMS.** Banks put names, account digits, UPI IDs and references in their messages. Run every sample through the anonymiser first and check its output by hand.
2. **No network code.** The only file allowed to touch the network is `src/llm/download.ts`, and ESLint enforces this.

## Add or fix a bank parser

The parser layer is pure TypeScript in `src/core/parsers/`, so you don't need an emulator to work on it.

1. Export the messages you want to support as a JSON array of `{ "address", "body", "date" }`.
2. Anonymise them:
   ```bash
   node --experimental-strip-types scripts/anonymize-sms.ts my-sms.json fixtures/sms/<bank>/
   ```
   The anonymiser writes fixture files marked `"needsReview": true`. In each one:
   - check the masking;
   - fill in or correct `expected`;
   - remove the `needsReview` flag.
3. Add or extend the parser in `src/core/parsers/banks/<bank>.ts`, then register it in the registry.
   - Order matters: a more specific sender must come first. For example, HDFC Mutual Fund goes before HDFC.
4. Run the parser tests until everything passes:
   ```bash
   npm run test:core
   ```
5. If a change alters the shape of the parser output, bump `PARSER_SCHEMA_VERSION`. The app will then re-parse stored messages.

Each parser outputs a `ParsedEvent` (see `src/core/types.ts`):
- amounts in integer paise;
- the direction (debit or credit) and the status;
- the last 4 digits of the account;
- the counterparty;
- the references (UPI / UTR / other);
- the reported balance;
- hints, such as an ATM withdrawal, a card bill payment, or a refund.

## Change ledger behaviour

Deduplication, transfer matching, categorisation and the daily close live in `src/core/ledger/`.

- Add a scenario test to `src/core/ledger/__tests__/` that asserts the daily-close numbers.
- The property test must keep passing: shuffling the inputs or rescanning must produce an identical ledger.
- Bump `LEDGER_VERSION` when the ledger's semantics change.

## Code style

- TypeScript strict.
- `npm run lint`, `npm run typecheck` and `npm test` must all pass.
- Code inside `src/core` must not import React Native.
- Screens use theme tokens from `src/ui/theme`, never hard-coded colours.

## License

By contributing you agree that your work is licensed under AGPL-3.0-or-later.

Code ported from another AGPL project must carry the upstream credit header and be added to `NOTICE.md`.
