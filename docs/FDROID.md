# Publishing PennyTrace on F-Droid

F-Droid does not take APK uploads. You publish **source plus a build recipe**; F-Droid builds the app itself and signs it with its own key.

Legend: ✅ done in this repo · ☐ you do it · ⚠ not verified against F-Droid's servers.

## What is ready

- ✅ No INTERNET permission, no AI model (llama.rn and its downloaded native libraries are gone).
- ✅ `fastlane/metadata/android/en-US/`: title, short and full description, icon, 5 phone screenshots, changelog for versionCode 1. F-Droid reads the store listing from here.
- ✅ `docs/fdroid/com.pennytrace.yml`: draft build recipe (copy it into fdroiddata, step 5).
- ✅ Release signing only applies when `PENNYTRACE_RELEASE_STORE_FILE` is set, so F-Droid's build comes out unsigned and F-Droid signs it. Your passwords live in `~/.gradle/gradle.properties`.
- ✅ Licence AGPL-3.0-or-later, `LICENSE` and `NOTICE.md` in the repo.

## Known review risk: prebuilt OpenSSL

`@op-engineering/op-sqlite` (SQLCipher) links OpenSSL from a prebuilt Maven AAR, `io.github.ronickg:openssl:3.3.2-1`. F-Droid's scanner or reviewers may object to a binary dependency they did not build. It is not an npm blob, so `scandelete` does not remove it. ⚠ Not verified; `fdroid build` (step 4) will show whether the scanner flags it. If it does, the fix is to build OpenSSL from source in the recipe's `prebuild`, or to ask the F-Droid reviewers what they accept. Also: op-sqlite ships unused prebuilt libsql/turso/sqlite-vec `.so` files inside `node_modules`; they are not packaged into the APK (those options are off) and `scandelete: node_modules` removes them from the scan.

## Steps

1. ☐ **Commit and push** everything to `main` on GitHub (`ratnesh-maurya/PennyTrace`). Check `git status` shows no `.keystore`, no `gradle.properties` passwords and no `fixtures/` with real SMS.
2. ☐ **GitHub Pages** (for the privacy policy link in the app): Settings → Pages → Deploy from a branch → `main` → `/docs`.
3. ☐ **Tag the release.** The recipe builds the tag `v1.0`:
   ```bash
   git tag v1.0 && git push origin v1.0
   ```
   For every later release: raise `versionCode` and `versionName` in `android/app/build.gradle`, add `fastlane/metadata/android/en-US/changelogs/<versionCode>.txt`, commit, tag `v<versionName>`. F-Droid notices new tags by itself (`UpdateCheckMode: Tags`, `AutoUpdateMode: Version`).
4. ☐ **Test the recipe locally** (recommended, saves review round trips). With Docker:
   ```bash
   git clone https://gitlab.com/fdroid/fdroiddata && cd fdroiddata
   cp /path/to/PennyTrace/docs/fdroid/com.pennytrace.yml metadata/
   docker run --rm -v "$PWD":/repo registry.gitlab.com/fdroid/fdroidserver:buildserver \
     sh -c 'cd /repo && fdroid readmeta && fdroid lint com.pennytrace && fdroid build -v -l com.pennytrace'
   ```
   ⚠ The JDK `sed` lines in `prebuild` are from F-Droid's React Native template and may need adjusting for RN 0.87. If the build fails, the error tells you which file; fix the recipe, not the app.
5. ☐ **Submit.** Create a GitLab account, fork `fdroid/fdroiddata`, add `metadata/com.pennytrace.yml`, and open a merge request titled **New App: com.pennytrace**. Fill in the checklist in the MR template. Reviewers may ask about the permissions (answer: SMS read/receive for bank alerts, boot receiver to resume, nothing else).
6. ☐ After merge, F-Droid builds and publishes, usually within a few days.

## Installing from F-Droid: what to expect

- F-Droid signs with its own key. A copy installed from your own APK (different key) must be **uninstalled first**; it cannot be updated in place. Choose one source.
- Android 13+ restricts READ_SMS/RECEIVE_SMS for apps installed from outside Google Play ("restricted settings"). If the SMS prompt is greyed out: Settings → Apps → PennyTrace → ⋮ → **Allow restricted settings**, then retry. ⚠ Whether an install via the F-Droid client avoids this is not confirmed; it depends on the installer used. Test on your own phone.
- India-specific Play Protect warnings on sideloaded SMS apps are a Google Play Services behaviour, not something the F-Droid build changes. ⚠ Not verified.
