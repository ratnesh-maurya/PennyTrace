# Publishing PennyTrace on Google Play

A checklist for getting PennyTrace through Play review, **especially the SMS Permissions Declaration**, which is the step most likely to take time or be rejected.

Legend: ✅ done and checked in this repo · ☐ you do it · ⚠ I could not check this against Play Console itself, so read the form's own wording before answering.

The policy facts below come from Google's help pages (SMS and Call Log permissions policy; User Data policy; Data safety help; "Declare permissions for your app"), read on 10 Oct 2026. Play changes its rules, so treat the Console as the final word.

Run `npm run check:play` at any point: it re-checks everything automatic.

---

## The big picture

| Step | What | Who |
|---|---|---|
| 1 | Play Developer account | ☐ you |
| 2 | Public privacy policy page | ☐ you push + enable Pages (page itself ✅) |
| 3 | Build the signed bundle | ✅ `npm run bundle:release` |
| 4 | Create the app, upload the bundle to **internal testing** | ☐ you |
| 5 | **Permissions Declaration Form** (SMS) appears: fill it | ☐ you (text below) |
| 6 | App content: Data safety, privacy policy, financial features, rating… | ☐ you (answers below) |
| 7 | Store listing + graphics | ☐ you (draft below) |
| 8 | Testing tracks, then production | ☐ you |

**Review can take several weeks.** While the SMS declaration is pending, Play keeps the app in "pending publication" and you **cannot publish any change at all**, store listing edits included. So finish everything else first, and submit only when the listing, video and answers are final.

---

## 1. Account, signing, versions

- ☐ Create a Play Developer account (one-time registration fee, identity verification).
- ⚠ **Testing requirement for new personal accounts.** As far as I know, personal accounts created after late 2023 must run a **closed test with about 12 testers for 14 days** before they can apply for production. Organisation accounts are exempt. Check what Play Console shows for your account, because if it applies, start recruiting testers now.
- ☐ **Play App Signing:** when you create the app, accept Play App Signing. Your `android/app/release.keystore` then becomes your **upload key**.
  - ☐ Back up `release.keystore` and its passwords somewhere safe (a password manager). Don't commit them.
  - ✅ The bundle is signed with it (fingerprint SHA-256 `C0:F7:2B:87:…:69:65`).
- ✅ Signing passwords now live in `~/.gradle/gradle.properties`, not in the repo (`npm run check:play` verifies this).
- ☐ Before **every** upload, raise `versionCode` in `android/app/build.gradle` (currently `1`). Play rejects a bundle whose `versionCode` it has already seen.
- ✅ `targetSdkVersion` is 36 and `minSdkVersion` is 26.
- ✅ Native libraries are **16 KB page-aligned** (checked on all 32 libraries; Play requires this for apps targeting Android 15 and later).
- ✅ Only arm64 is shipped (`arm64-v8a`), which meets Play's 64-bit requirement but excludes the few 32-bit-only phones.

## 2. Build the bundle

```bash
npm run bundle:release
# → android/app/build/outputs/bundle/release/app-release.aab   (~97 MB)
```

- ✅ **Bank logos are left out** of the bundle (it sets `PENNYTRACE_NO_LOGOS=1` and clears stale resources). They are the banks' trademarks, and showing them in a store build could read as a partnership with those banks. Your own local builds can still use them.
- ✅ The only permissions are `READ_SMS`, `RECEIVE_SMS`, `RECEIVE_BOOT_COMPLETED` and `WAKE_LOCK` (added by WorkManager). **No `INTERNET`**, no foreground service, no notifications. **No `SEND_SMS`, `WRITE_SMS`, `RECEIVE_MMS` or `RECEIVE_WAP_PUSH`.** Don't add any: the declaration lists exactly what you use.
- ☐ Install the **APK** (`npm run release:apk`) on a real phone and walk through the whole app once before uploading, with the SMS video steps below.

## 3. What the app already does for the policy ✅

| Play requires | In the app |
|---|---|
| **Prominent disclosure** inside the app, *before* the permission prompt, saying what is read and why, with an affirmative tap. It cannot live only in the privacy policy. | The first screen says it reads the inbox and each new SMS to find bank/UPI alerts, what is skipped, what is kept, and that nothing leaves the phone. The button reads **"Agree and allow SMS access"**, and the system prompt comes only after that tap. |
| A privacy policy link **inside the app** | Privacy tab → About → **Privacy policy**. |
| Access only for the declared core function; no misuse of SMS history | Non-financial messages (OTPs, promotions, chats) are skipped and **no text is stored for them**, only the sender. Nothing is transmitted. |
| No sale or sharing of SMS data | None: there is no server and no analytics or ad software. |
| Honest data handling | **Privacy → Discard raw messages** removes all kept message text, including alerts the app couldn't read. |
| Core function is the declared purpose | The whole app is the SMS ledger: with no SMS access only the demo data works. |

⚠ Keep the disclosure text and the policy in line with the code. If you change what is read or stored, update both, and update the Data safety form and the declaration form too ("If you change how the app uses the permissions, you must resubmit the form").

## 4. Privacy policy (public page)

- ✅ `docs/privacy-policy.html` is written from what the code does, and your contact email is in it.
- ☐ Push to GitHub, then **Settings → Pages → Deploy from a branch → `main` → `/docs`**.
- ☐ Confirm `https://ratnesh-maurya.github.io/PennyTrace/privacy-policy.html` opens in a private browser tab. (`npm run check:play` also checks this.)
- Play requires the policy to be an **active, public URL, not a PDF, and not editable**. A GitHub Pages page qualifies. The developer or app name from the store listing must appear on it ✅ ("PennyTrace").
- If you ever change the URL, change it in `src/app/links.ts` **and** in Play Console.

## 5. The SMS Permissions Declaration Form  ⭐

⚠ This form appears **during release**, after you upload a bundle that uses `READ_SMS` / `RECEIVE_SMS`. You can't fill it in before that. Allow weeks for review.

**Core functionality / use case:** choose **"SMS-based money management"**. Google's own description is "apps that track and manage budget", with permissions `READ_SMS`, `RECEIVE_SMS` (plus `RECEIVE_MMS` and `RECEIVE_WAP_PUSH`, which you don't request). Do **not** choose "SMS-based financial transactions": that one is for UPI-style apps and verifications.

Starting text, to put in your own words (the form asks you to explain why the permission is needed and why no alternative will do):

> **What the app does.** PennyTrace is a personal expense tracker. It builds the user's ledger automatically from the bank and UPI transaction alerts that Indian banks send by SMS, so the user never has to type transactions.
>
> **Why READ_SMS.** The first thing the app does is import the transaction alerts already in the user's inbox (the user chooses 3 months, 6 months or 1 year) to calculate balances, spending and daily closing balances. Without read access to the inbox the app cannot work; it has no manual-entry mode.
>
> **Why RECEIVE_SMS.** To add a new transaction within seconds of its alert arriving, and to catch up on alerts received while the phone was off.
>
> **Why no alternative works.** The SMS Retriever API only delivers one-time-password messages tagged with an app hash, which bank transaction alerts don't carry. The SMS User Consent API shows one message per request. Neither can import a history or read ongoing transaction alerts. Notification access is a more sensitive permission and would miss messages.
>
> **How the data is handled.** All processing happens on the device. Alerts are turned into amounts, dates, merchants, account digits and balances in an encrypted local database (SQLCipher, key in the Android Keystore). Messages that are not transaction alerts (OTPs, promotions, personal chats) are skipped and their text is not stored. Nothing is transmitted, shared or sold. The app has no server, no account, and no analytics or advertising software. It requests no permission to send or write SMS.

**Reviewer instructions / app access.** Choose that all functionality is available without special access (there is no sign-in), and add:

> No account is needed. On first launch the app explains and asks for SMS access. If your test device has no bank SMS, tap **"Explore with demo data"** on the first screen to see the full app with a built-in sample week of bank SMS, processed by the same engine.
>
> To test live SMS: grant the permission, then on an emulator run `adb emu sms send AX-HDFCBK "Rs.349.00 debited from A/c XX1234 on 10-Oct-26 to VPA swiggy@icici (UPI Ref No 428100000110)"`. The transaction appears under Activity within a few seconds. Tap it to see the SMS evidence behind it.

☐ **Demo video** (Play prefers a YouTube link; unlisted is fine). About 2 minutes, on a real phone, in this order:
1. Fresh install → open the app → the screen with the disclosure text (hold on it).
2. Tap **Agree and allow SMS access** → the system permission prompt → **Allow**.
3. Choose the history length → the import → the **Today** screen with the daily close.
4. **Activity** → tap a transaction → the **evidence** screen showing the SMS it came from.
5. Receive a new bank SMS (send one to the phone) → it appears in Activity.
6. **Privacy** tab: "Nothing leaves this phone", **Discard raw messages**, the **Privacy policy** link.
7. Show what the app does *without* permission (denied: the app shows how to allow it, and the demo data).

⚠ Use **demo data or a test phone** for the video. Never film your real messages or balances.

☐ Tick the confirmation boxes only when everything above is true of the build you are uploading.

## 6. App content (Play Console → Policy and programs)

| Form | Answer |
|---|---|
| **Privacy policy URL** | The Pages URL from section 4. |
| **Data safety** | **No data collected, no data shared.** Google defines "collect" as *transmitting data off the device*, and data that only stays on the device "does not need to be disclosed". Declaring a permission alone does not trigger a disclosure. You must still complete the form and give the policy link. The app has no internet permission, so there is no transmission to declare. |
| **Financial features** | ⚠ Finance apps are asked to declare financial features. PennyTrace tracks only: it has no payments, loans, banking, investments or crypto features. Choose the option that says so. |
| **Target audience** | 18+ (not for children). |
| **Content rating** | Complete the IARC questionnaire: no violence, no user-generated content, no in-app purchases. |
| **Ads** | The app contains no ads. |
| **Account deletion** | The app has no accounts, so this likely doesn't apply (⚠ confirm in the form). The privacy policy states how to delete all data (uninstall or clear storage). |
| **Government / news / health apps** | No. |

## 7. Store listing

Google requires the description to **"prominently document and promote"** the core feature. Lead with the SMS ledger.

- **Title (30 max):** `PennyTrace: Expense Tracker` (27)
- **Short description (80 max):** `Automatic expense tracker from your bank SMS. 100% on-device, no cloud.` (71)
- **Category:** Finance. **Contact email, website** (the GitHub page), **privacy policy URL**.

**Full description (draft):**

> PennyTrace builds your expense ledger automatically from the bank and UPI SMS your phone already receives. You never type a transaction.
>
> **How it works**
> • Reads the bank and UPI alerts in your SMS inbox, and each new one as it arrives, on your phone.
> • Counts the same payment once even when your bank and UPI app both send an alert.
> • Knows your own money: transfers between your accounts, credit-card bill payments and ATM cash are not counted as spending, and a transfer whose credit hasn't arrived yet shows as "in transit".
> • A daily close for each day: opening balance, money in, money spent, moved, closing balance, for one account or all together.
> • Compares what your SMS add up to with the balance your bank reported, and shows the difference instead of hiding it.
> • Sorts spending into categories, learns from your corrections, and lets you create your own categories.
> • Credit cards on their own: limit, used and available, kept out of your closing balance.
> • No internet permission: the app can't connect to anything, so nothing can leave your phone.
>
> **Private by design**
> • Everything stays on your phone, in an encrypted database. There is no account, no server, no ads and no analytics.
> • Messages that aren't transaction alerts (OTPs, promotions, chats) are skipped, and their text is never stored.
> • Your messages never leave your device. PennyTrace can't send, delete or change them.
> • Open source (AGPL-3.0).
>
> **Permission:** PennyTrace needs SMS access (read and receive) because reading your bank alerts is the whole app. Without it, only the built-in demo works.
>
> Made for Indian bank and UPI messages (₹).

- ✅ **Listing icon:** `assets/brand/icon-512.png` (512 × 512 PNG, full square: Google rounds the corners itself).
- ✅ **Launcher icon:** installed in `android/app/src/main/res` (adaptive icon for Android 8+, plus square and round versions for older launchers). Checked on an emulator. Regenerate it with `python3 scripts/make-logo.py && scripts/render-logo.sh && python3 scripts/install-android-icons.py`.
- ☐ **Feature graphic:** 1024 × 500.
- ☐ **Screenshots:** at least 2 phone screenshots. ⚠ **Take them with "Explore with demo data"**, never your real data. There are no bank logos in the Play build, so the screenshots match what users get.
- ⚠ Don't use any bank's name or logo in the title, icon or graphics as if affiliated. Mentioning "bank SMS" in general is fine.

## 8. Testing, then release

1. ☐ Create the app → **Internal testing** → upload the `.aab` → add yourself as a tester → install from the Play link on a real phone.
   - ⚠ I don't know whether SMS permission works on an internal-testing install **before** the declaration is approved. Try it; if the permission is blocked, that is expected until approval.
2. ☐ Fill in everything in sections 5–8.
3. ☐ If the testing requirement in section 1 applies: closed test, about 12 testers, 14 days, before applying for production.
4. ☐ Check the **pre-launch report** Play generates (crashes on its test devices).
5. ☐ Submit. Expect the SMS declaration review to take **up to several weeks**; don't touch anything while it's pending.
6. For a later urgent fix while the declaration is pending, Play lets you ship a release **without** the sensitive permissions. Keep that in mind rather than changing the declaration mid-review.

## 10. If the declaration is rejected

The most likely objection for this app is that **manual entry or another route is an alternative**. The answer is in the text above: the product *is* automatic ingestion of bank alerts, history import is impossible with any other API, and there is no manual mode by design. Other likely points:

- The disclosure or video doesn't show the permission prompt → re-record steps 1–2.
- The listing doesn't promote the SMS feature enough → lead with it (section 8).
- The policy or Data safety form doesn't match the app → fix whichever is wrong, then resubmit.
- Any new permission, or a change in how SMS is used, needs a **new declaration**.

Never remove the disclosure screen to "make it shorter", and never add analytics or crash reporting later without updating the policy, the Data safety form and the declaration first.
