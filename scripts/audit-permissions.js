#!/usr/bin/env node
/**
 * Verifies the release APK requests only allowlisted permissions (plan §7).
 *
 *   npm run release:apk && npm run audit:permissions
 *   node scripts/audit-permissions.js [path/to/app.apk]
 *
 * Uses `aapt dump permissions` from the newest installed build-tools
 * (ANDROID_HOME, default ~/Library/Android/sdk). Exits 1 on any extra permission.
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ALLOWLIST = new Set([
  'android.permission.INTERNET', // model download only
  'android.permission.READ_SMS',
  'android.permission.RECEIVE_SMS',
  'android.permission.POST_NOTIFICATIONS',
  'android.permission.RECEIVE_BOOT_COMPLETED',
  'android.permission.WAKE_LOCK', // WorkManager scan + downloader
  'android.permission.FOREGROUND_SERVICE', // downloader (dataSync)
  'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
  // Model downloader: Wi-Fi-only check / job network constraint (no network access by itself)
  'android.permission.ACCESS_NETWORK_STATE',
  // Model downloader: Android 14+ user-initiated data-transfer job
  'android.permission.RUN_USER_INITIATED_JOBS',
  'com.pennytrace.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION', // androidx.core, signature-level, app-private
]);

const ROOT = path.resolve(__dirname, '..');

function androidHome() {
  return process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || path.join(os.homedir(), 'Library/Android/sdk');
}

function compareVersions(a, b) {
  const pa = a.split(/[.-]/).map(n => parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) {
      return d;
    }
  }
  return 0;
}

function findAapt() {
  const dir = path.join(androidHome(), 'build-tools');
  if (!fs.existsSync(dir)) {
    throw new Error(`No build-tools in ${dir}. Set ANDROID_HOME.`);
  }
  const versions = fs
    .readdirSync(dir)
    .filter(v => fs.existsSync(path.join(dir, v, 'aapt')))
    .sort(compareVersions);
  if (versions.length === 0) {
    throw new Error(`No aapt found under ${dir}/*/aapt`);
  }
  return path.join(dir, versions[versions.length - 1], 'aapt');
}

function findApk(arg) {
  if (arg) {
    return path.resolve(arg);
  }
  const dir = path.join(ROOT, 'android/app/build/outputs/apk/release');
  const apks = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.apk')) : [];
  if (apks.length === 0) {
    throw new Error(`No release APK in ${dir}. Run: npm run release:apk`);
  }
  // Prefer the universal APK when ABI splits are enabled.
  apks.sort((a, b) => (a.includes('universal') ? -1 : b.includes('universal') ? 1 : a.localeCompare(b)));
  return path.join(dir, apks[0]);
}

/** Parses `aapt dump permissions` output (both `uses-permission: name='x'` and legacy `uses-permission: x`). */
function parsePermissions(out) {
  const perms = new Set();
  for (const line of out.split('\n')) {
    const m = line.match(/^uses-permission(?:-sdk-23)?:\s*(?:name=')?([^'\s]+)'?/);
    if (m) {
      perms.add(m[1]);
    }
  }
  return perms;
}

function main() {
  const apk = findApk(process.argv[2]);
  const aapt = findAapt();
  const out = execFileSync(aapt, ['dump', 'permissions', apk], { encoding: 'utf8' });
  const perms = [...parsePermissions(out)].sort();
  const extras = perms.filter(p => !ALLOWLIST.has(p));

  console.log(`APK:  ${path.relative(ROOT, apk)}`);
  console.log(`aapt: ${aapt}`);
  for (const p of perms) {
    console.log(`  ${ALLOWLIST.has(p) ? 'ok   ' : 'EXTRA'} ${p}`);
  }
  if (extras.length > 0) {
    console.error(
      `\n${extras.length} permission(s) not on the allowlist. Remove them in ` +
        'android/app/src/main/AndroidManifest.xml with tools:node="remove", or justify and add them here.',
    );
    process.exit(1);
  }
  console.log('\nPermissions match the allowlist.');
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    console.error(e.message);
    process.exit(2);
  }
}

module.exports = { parsePermissions, ALLOWLIST };
