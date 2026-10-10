#!/usr/bin/env node
/**
 * Preflight for a Play Store submission. Runs on your computer (never in the app).
 *
 *   npm run check:play
 *
 * Fails (exit 1) on anything Play review or a leaked secret would catch. Items it cannot see
 * (Play Console forms, the demo video) are in docs/PLAY_STORE.md.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const results = [];
const check = (ok, label, detail = '') => results.push({ ok, label, detail });

async function main() {
  // 1. Privacy policy: placeholders gone, and the public URL actually serves it.
  const policy = read('docs/privacy-policy.html');
  check(
    !/REPLACE-ME/.test(policy),
    'privacy policy has no REPLACE-ME placeholders',
    'fill in your contact email in docs/privacy-policy.html',
  );
  const url = /PRIVACY_POLICY_URL\s*=\s*'([^']+)'/.exec(read('src/app/links.ts'))?.[1];
  try {
    const res = await fetch(url, { redirect: 'follow' });
    const body = res.ok ? await res.text() : '';
    check(
      res.ok && body.includes('PennyTrace Privacy Policy') && !/REPLACE-ME/.test(body),
      `privacy policy is live at ${url}`,
      res.ok
        ? 'the live page differs from docs/privacy-policy.html: push and wait for GitHub Pages'
        : `HTTP ${res.status}: enable GitHub Pages (Settings → Pages → main /docs)`,
    );
  } catch (e) {
    check(false, `privacy policy is live at ${url}`, `could not fetch (${e.message})`);
  }

  // 2. Secrets: signing passwords must not sit in a file git tracks.
  const tracked =
    spawnSync('git', ['ls-files', 'android/gradle.properties'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim() !== '';
  const leaky = tracked && /PENNYTRACE_RELEASE_\w*PASSWORD\s*=/.test(read('android/gradle.properties'));
  check(
    !leaky,
    'no signing passwords in android/gradle.properties',
    'move PENNYTRACE_RELEASE_* to ~/.gradle/gradle.properties',
  );
  const keystoreTracked = spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .stdout.split('\n')
    .some(f => /release\.keystore|\.jks$/.test(f));
  check(!keystoreTracked, 'release keystore is not tracked by git');

  // 3. Manifest: only the SMS permissions the declaration covers.
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  const sms = [...manifest.matchAll(/<uses-permission android:name="android\.permission\.(\w*(?:SMS|MMS|WAP)\w*)"/g)]
    .map(m => m[1])
    .sort();
  check(
    JSON.stringify(sms) === JSON.stringify(['READ_SMS', 'RECEIVE_SMS']),
    'SMS permissions are exactly READ_SMS and RECEIVE_SMS',
    `found: ${sms.join(', ') || 'none'}`,
  );

  // 4. The bundle and the permission audit.
  const aab = path.join(ROOT, 'android/app/build/outputs/bundle/release/app-release.aab');
  check(fs.existsSync(aab), 'release bundle exists', 'run: npm run bundle:release');
  if (fs.existsSync(aab)) {
    const listing = spawnSync('unzip', ['-l', aab], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stdout;
    check(
      !/assets_banks_/.test(listing),
      'bundle contains no bank logos',
      'bank logos are trademarks: build with npm run bundle:release (it sets PENNYTRACE_NO_LOGOS=1)',
    );
  }
  const apk = path.join(ROOT, 'android/app/build/outputs/apk/release/app-release.apk');
  if (fs.existsSync(apk)) {
    const audit = spawnSync('node', ['scripts/audit-permissions.js'], { cwd: ROOT, encoding: 'utf8' });
    check(
      audit.status === 0,
      'release APK permissions match the allowlist',
      audit.stdout
        .split('\n')
        .filter(l => /EXTRA/.test(l))
        .join('; '),
    );
  }

  const versionCode = /versionCode\s+(\d+)/.exec(read('android/app/build.gradle'))?.[1];
  let failed = 0;
  for (const r of results) {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.label}${!r.ok && r.detail ? `\n        → ${r.detail}` : ''}`);
    failed += r.ok ? 0 : 1;
  }
  console.log(`\nversionCode is ${versionCode}: it must be higher than every build you have uploaded before.`);
  console.log(
    failed ? `\n${failed} check(s) failed.` : '\nAll automatic checks passed. Now work through docs/PLAY_STORE.md.',
  );
  process.exit(failed ? 1 : 0);
}

main();
