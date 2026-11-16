// Local controlled pilot, no PMS required. Default: read-only/dry-run.
// Usage: node local-pilot.mjs --room-id 12 --clear  (interactive confirmation; room id must match config.json).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createAdbAdapter } from './adb-adapter.mjs';
import { APPROVED_PACKAGES, parseThirdPartyPackages, addedThirdPartyPackages, PILOT_VERIFIED_PACKAGES } from '../shared/privacy-core.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url));
const file=process.env.CORALI_TV_PRIVACY_CONFIG || path.join(dir,'config.json');
const conf=JSON.parse(fs.readFileSync(file,'utf8'));
const args=process.argv.slice(2);
const idIndex=args.indexOf('--room-id');
const roomId=idIndex>=0 ? String(args[idIndex+1]||'') : '';
const clear=args.includes('--clear');
const allApps=args.includes('--all-five');
const baselineFile=path.resolve(dir,'..','baseline','tv112-third-party-baseline.txt');
const entry=conf.roomMap?.[roomId];
if(!entry || !/^[1-9]\d*$/.test(roomId) || !process.env.ADB_PATH) throw new Error('Set --room-id <internal id>, config.json roomMap and ADB_PATH first');
const adapter=createAdbAdapter({adbPath:process.env.ADB_PATH,serial:entry.serial,androidId:entry.androidId});
console.log('Pilot: room label',entry.label,'devices bound by android_id; destructive:',clear);
if(clear) {
  const rl=createInterface({input:stdin,output:stdout});
  try {
    const answer=await rl.question(`This will erase LOCAL app data for ${allApps?"5 packages (including 2 not yet live-pilot verified)":"3 pilot-verified packages"}. Type CLEAR ${entry.label} to confirm: `);
    if(answer!==`CLEAR ${entry.label}`) throw new Error('Cancelled: confirmation did not match');
  } finally {rl.close();}
}
const results=[];
let addedApps=[];
let inventoryStatus='UNAVAILABLE';
const selected=allApps?APPROVED_PACKAGES:PILOT_VERIFIED_PACKAGES;
try {
  await adapter.assertIdentity();
  const current=parseThirdPartyPackages(await adapter.listThirdPartyPackages());
  if (fs.existsSync(baselineFile)) {
    const baseline=parseThirdPartyPackages(fs.readFileSync(baselineFile,'utf8'));
    addedApps=addedThirdPartyPackages(baseline,current);
    inventoryStatus='COMPARE_OK';
  } else inventoryStatus='BASELINE_MISSING';
  for (const name of selected) {
    try { results.push(await adapter.clearPackage(name,{dryRun:!clear})); }
    catch { results.push({package:name,status:'FAILED',code:'ADB_OPERATION_FAILED'}); }
  }
} catch { results.push({package:APPROVED_PACKAGES[0],status:'BLOCKED_SECURITY',code:'ADB_PREFLIGHT_OR_INVENTORY_FAILED'}); }
console.log(JSON.stringify({roomLabel:entry.label,mode:clear?'LOCAL_CLEAR':'DRY_RUN',result:clear?'LOCAL_CLEARS_NEED_MANUAL_REVIEW':'DRY_RUN',inventoryStatus,newThirdPartyPackages:addedApps,apps:results,unverifiedAppsIncluded:allApps},null,2));
console.log('Review app login screens and OS accounts manually. NEVER auto-uninstall detected packages; no Google OS accounts were cleared.');
