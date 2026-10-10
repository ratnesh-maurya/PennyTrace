# PennyTrace

**A ledger that keeps itself.** PennyTrace is an open-source, local-first expense tracker for
Android. It builds your financial ledger automatically from bank and UPI SMS alerts. You don't
type anything, there's no account to sign up for, and nothing goes to the cloud.

- **Automatic capture.** Reads bank and UPI SMS on your phone, and picks up new alerts within
  seconds.
- **One transaction, counted once.** Duplicate alerts are merged by UPI reference or UTR, and
  partner-bank copies are recognised. Two real ₹500 purchases still count as two.
- **Knows your own money moves.** Transfers between your own accounts, credit-card bill payments
  and ATM withdrawals are never counted as spending. A transfer whose credit hasn't arrived yet is
  shown as *in transit*.
- **Daily close.** For any day, per account or across all of them: opening → in → spent → moved →
  closing.
- **Reconciliation.** Shows the balance PennyTrace calculated next to the balance your bank
  reported. Any variance is shown to you, never silently fixed.
- **Categories and names.** Merchants, people and billers are categorised with a confidence
  score. When it isn't sure, it asks you, and your answer becomes a rule stored on the device.
- **No internet at all.** The app doesn't even request the permission, so it can't send anything
  anywhere. There is no AI model and no cloud service.

## Privacy model

| | |
|---|---|
| Network | None. The release build has no INTERNET permission (the debug build adds it only so Metro can connect). |
| Storage | SQLite encrypted with SQLCipher. The key is kept in the Android Keystore. |
| Backups | Android cloud backup and device-transfer backup are disabled. |
| Telemetry | None. No analytics, crash reporting, Firebase or ads. |
| Raw SMS | Stored encrypted so messages can be re-parsed. You can choose to discard them after parsing. |

### Verify it yourself

```bash
npm run release:apk && npm run audit:permissions   # only allow-listed permissions, never INTERNET
```

The release APK asks for `READ_SMS`, `RECEIVE_SMS` and `RECEIVE_BOOT_COMPLETED` (plus a wake lock
added by AndroidX WorkManager). You can also run it in airplane mode: nothing changes.

## Tech

React Native CLI 0.87 (bare, New Architecture), TypeScript, Kotlin TurboModules for SMS access,
and op-sqlite with SQLCipher and drizzle. See [`plan.md`](plan.md)
for the architecture and [`CLAUDE.md`](CLAUDE.md) for the conventions.

## Getting started

Requirements: Node ≥ 22, JDK 17, and an Android SDK. Set `ANDROID_HOME`, for example to
`~/Library/Android/sdk`.

```bash
npm install
npm start
npm run android
```

To test with fake SMS on an emulator:

```bash
adb emu sms send AX-HDFCBK "Rs.349.00 debited from a/c **1234 on 09-10-26 to VPA swiggy@icici. UPI Ref 412345678901. Avl Bal Rs.31800.00"
```

## Contributing

Adding support for a new bank is the most useful contribution. See
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## License and credits

PennyTrace is licensed under the **GNU AGPL-3.0-or-later** ([`LICENSE`](LICENSE)).

The SMS parsers and the deduplication logic are ported from
[pennywiseai-tracker](https://github.com/sarim2000/pennywiseai-tracker), which is also AGPL-3.0.
Full credits are in [`NOTICE.md`](NOTICE.md).
