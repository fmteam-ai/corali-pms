// Corali TV — guest app data clearing at check-out (v161, from the "Unified Staging" kit). Pure and shared:
// the PMS bridge (lib/tv-privacy.ts) and the on-prem gateway (tools/tv-privacy-gateway, an identical copy in
// shared/privacy-core.mjs — tests/tv-privacy.test.ts checks they match).
// Audited allowlist. Adding a service requires a per-device pilot test.
// Do NOT include Google Play Services, Google accounts, OS settings, TV Agent or launchers.
export const APPROVED_PACKAGES = Object.freeze([
  'com.google.android.youtube.tv',
  'com.netflix.ninja',
  'com.amazon.amazonvideo.livingroom',
  'com.disney.disneyplus',
  'com.google.android.youtube.tvmusic',
]);
export const MAX_ATTEMPTS = 3;
export const LEASE_MS = 120_000;
export const JOB_STATUSES = Object.freeze([
  'QUEUED', 'RUNNING', 'CLEARED_LOCAL_NEEDS_REVIEW', 'PARTIAL',
  'FAILED', 'BLOCKED_NEW_GUEST', 'BLOCKED_UNREGISTERED', 'BLOCKED_SECURITY',
  'UNVERIFIED', 'DRY_RUN',
]);
export function containsNewGuest(bookings, job) {
  return bookings.some(b => Number(b.id) !== Number(job.booking_id) &&
    (b.status === 'checked_in' || (Number(b.checked_in_at ?? 0) > Number(job.checkout_at_ms))));
}
export function normalizeAppResult(item) {
  if (!item || !APPROVED_PACKAGES.includes(item.package)) throw new Error('UNAPPROVED_PACKAGE');
  if (!['CLEARED_LOCAL','NOT_INSTALLED','FAILED','BLOCKED_SECURITY','DRY_RUN'].includes(item.status)) throw new Error('INVALID_APP_STATUS');
  return { package: item.package, status: item.status, code: String(item.code ?? '').replace(/[^A-Z0-9_]/g,'').slice(0,48) };
}
export function classifyResults(results, dryRun) {
  if (dryRun) return 'DRY_RUN';
  const found = new Map(results.map(x => [x.package, x]));
  if (found.size !== APPROVED_PACKAGES.length || APPROVED_PACKAGES.some(p => !found.has(p))) return 'UNVERIFIED';
  if (results.some(r => r.status === 'BLOCKED_SECURITY')) return 'BLOCKED_SECURITY';
  if (results.some(r => r.status === 'FAILED')) return results.some(r=>r.status==='CLEARED_LOCAL') ? 'PARTIAL' : 'FAILED';
  if (results.some(r => r.status === 'DRY_RUN')) return 'DRY_RUN';
  if (results.every(r => ['CLEARED_LOCAL','NOT_INSTALLED'].includes(r.status))) return 'CLEARED_LOCAL_NEEDS_REVIEW';
  return 'UNVERIFIED';
}
export function isSafeJob(job, mapping) {
  return Number.isSafeInteger(Number(job?.roomId)) && Number(job?.roomId) > 0 &&
    Number.isSafeInteger(Number(job?.id)) && Number(job?.id) > 0 &&
    !!mapping && typeof mapping.serial === 'string' &&
    /^[A-Za-z0-9._:\-]+$/.test(mapping.serial) &&
    /^[0-9a-f]{16}$/i.test(mapping.androidId) &&
    !!job.leaseToken && /^[0-9a-f]{64}$/i.test(job.leaseToken) &&
    Array.isArray(job.packages) && job.packages.length === APPROVED_PACKAGES.length &&
    APPROVED_PACKAGES.every(p => job.packages.includes(p));
}

// Hotel-approved non-streaming packages are never cleared or uninstalled.
export const PROTECTED_PACKAGES = Object.freeze([
  'gr.hotelcorali.tv',
  'com.netflix.tokenmanager',
  'com.google.android.gms',
  'com.google.android.gsf',
  'com.android.vending',
  'com.android.tv.settings',
  'com.google.android.apps.tv.launcherx',
]);
export const PILOT_VERIFIED_PACKAGES = Object.freeze([
  'com.google.android.youtube.tv',
  'com.netflix.ninja',
  'com.amazon.amazonvideo.livingroom',
]);
export const UNVERIFIED_APP_PILOTS = Object.freeze([
  'com.disney.disneyplus',
  'com.google.android.youtube.tvmusic',
]);
export function parseThirdPartyPackages(text) {
  return Array.from(new Set(String(text).split(/\r?\n/).map(s=>s.trim())
    .filter(s=>s.startsWith('package:'))
    .map(s=>s.slice(8)).filter(p=>/^[a-zA-Z0-9_.]+$/.test(p)))).sort();
}
export function addedThirdPartyPackages(baseline, current) {
  const known=new Set(baseline);
  return [...current].filter(p=>!known.has(p)).sort();
}
// Capabilities supported by current pilot evidence; not an installed PMS integration.
export const TV_CAPABILITIES = Object.freeze({
  volume: {status:'PILOT_VERIFIED_IN_EXISTING_PMS',note:'8% startup / 30% maximum / mute / OFF tested; retain v160 implementation'},
  powerOn: {status:'UNSUPPORTED',note:'Mobile YouTube Cast wakes TV; Chrome/DIAL/remote wake unverified or failed; no safe PMS implementation'},
  menuLock: {status:'OEM_BRIDGE_REQUIRED',note:'Manual factory On/Off verified; agent lacks system privileges'},
  channelScanLock: {status:'OEM_BRIDGE_REQUIRED',note:'Manual factory On/Off verified; agent lacks system privileges'},
  checkoutClearAppData: {status:'PILOT_LOCAL_ADB_READY',note:'5 packages known, 3 live-tested; PMS deployment not completed'},
  removeGuestApps: {status:'REVIEW_REQUIRED',note:'Inventory diff works; never auto-uninstall on installer metadata alone'},
  hotelGoogleAccountProtected: {status:'NOT_FULLY_VERIFIED',note:'No OS account deletion performed; blocking account removal requires OEM/MDM'},
});

// v161 (PMS integration): guest-installed apps. The gateway compares the TV's third-party packages with the room's
// baseline; the PMS shows the additions and an admin may approve removing ONE listed package at a time. Never a
// protected / hotel / streaming-allowlist package, never a name that is not a plain Android package id.
export const PACKAGE_NAME = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/;
export function isRemovableGuestPackage(pkg, baseline = []) {
  return typeof pkg === 'string' && pkg.length <= 150 && PACKAGE_NAME.test(pkg) &&
    !PROTECTED_PACKAGES.includes(pkg) && !APPROVED_PACKAGES.includes(pkg) && !baseline.includes(pkg) &&
    !pkg.startsWith('com.google.android.') && !pkg.startsWith('com.android.') && !pkg.startsWith('com.realtek.') && !pkg.startsWith('com.expressluck.');
}
export const UNINSTALL_STATUSES = Object.freeze(['APPROVED', 'RUNNING', 'REMOVED', 'NOT_INSTALLED', 'FAILED', 'BLOCKED_NEW_GUEST', 'BLOCKED_SECURITY', 'BLOCKED_PROTECTED']);
export function normalizeUninstallResult(r) {
  const status = ['REMOVED', 'NOT_INSTALLED', 'FAILED', 'BLOCKED_SECURITY', 'BLOCKED_PROTECTED'].includes(r?.status) ? r.status : 'FAILED';
  return { status, code: String(r?.code ?? '').replace(/[^A-Z0-9_]/g, '').slice(0, 48) };
}
