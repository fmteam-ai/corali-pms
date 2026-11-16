import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { APPROVED_PACKAGES, isRemovableGuestPackage, parseThirdPartyPackages } from '../shared/privacy-core.mjs';
const exec = promisify(execFile);
export function createAdbAdapter({ adbPath, serial, androidId, execFileAsync=exec }) {
  if (!adbPath || !/^[A-Za-z0-9._:\-]+$/.test(serial) || !/^[0-9a-f]{16}$/i.test(androidId)) throw new Error('INVALID_ADB_CONFIG');
  const run = async args => {
    const out = await execFileAsync(adbPath, ['-s',serial,...args], {timeout:12000,maxBuffer:65536,windowsHide:true});
    return String(out.stdout ?? '').trim();
  };
  async function assertIdentity() {
    const seen = await run(['shell','settings','get','secure','android_id']);
    if (seen.toLowerCase() !== androidId.toLowerCase()) throw new Error('ANDROID_ID_MISMATCH');
    const state = await run(['get-state']);
    if (state !== 'device') throw new Error('ADB_DEVICE_NOT_READY');
  }
  async function clearPackage(packageName, {dryRun=true}={}) {
    if (!APPROVED_PACKAGES.includes(packageName)) throw new Error('UNAPPROVED_PACKAGE');
    await assertIdentity();
    const found = await run(['shell','pm','path',packageName]);
    if (!found.startsWith('package:')) return {package:packageName,status:'NOT_INSTALLED',code:'NOT_INSTALLED'};
    if (dryRun) return {package:packageName,status:'DRY_RUN',code:'NO_DELETION_PERFORMED'};
    const out = await run(['shell','pm','clear',packageName]);
    if (out !== 'Success') return {package:packageName,status:'FAILED',code:'ADB_PM_CLEAR_NOT_SUCCESS'};
    // This is LOCAL clear evidence only. No proof of OS-account removal or cloud logout.
    return {package:packageName,status:'CLEARED_LOCAL',code:'ADB_PM_CLEAR_SUCCESS'};
  }
  async function listThirdPartyPackages() {
    await assertIdentity();
    return await run(['shell','pm','list','packages','-3']);
  }
  // v161: remove ONE admin-approved guest-installed app, for the current user only (pm uninstall --user 0), after
  // checking identity, that the name is not protected / allowlisted / baseline, and that it is a third-party app.
  async function uninstallPackage(packageName, baseline = []) {
    if (!isRemovableGuestPackage(packageName, baseline)) return {status:'BLOCKED_PROTECTED',code:'PROTECTED_PACKAGE'};
    await assertIdentity();
    const third = parseThirdPartyPackages(await run(['shell','pm','list','packages','-3']));
    if (!third.includes(packageName)) return {status:'NOT_INSTALLED',code:'NOT_A_THIRD_PARTY_PACKAGE'};
    const out = await run(['shell','pm','uninstall','--user','0',packageName]);
    return out === 'Success' ? {status:'REMOVED',code:'ADB_PM_UNINSTALL_SUCCESS'} : {status:'FAILED',code:'ADB_PM_UNINSTALL_NOT_SUCCESS'};
  }
  return { assertIdentity, clearPackage, listThirdPartyPackages, uninstallPackage };
}
