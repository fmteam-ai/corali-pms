// Local Windows Node.js bridge (Node 22+). OUTBOUND HTTPS only to PMS.
// Must run on a trusted always-on LAN machine with authorised ADB pairing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdbAdapter } from './adb-adapter.mjs';
import { APPROVED_PACKAGES, isSafeJob, normalizeAppResult, classifyResults, parseThirdPartyPackages, addedThirdPartyPackages, normalizeUninstallResult } from '../shared/privacy-core.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const confPath = process.env.CORALI_TV_PRIVACY_CONFIG || path.join(here,'config.json');
const conf = JSON.parse(fs.readFileSync(confPath,'utf8'));
const token = process.env.TV_PRIVACY_BRIDGE_TOKEN;
const adbPath = process.env.ADB_PATH;
if (!token || token.length < 32 || !adbPath) throw new Error('Missing TV_PRIVACY_BRIDGE_TOKEN or ADB_PATH');
const endpoint = new URL(conf.pmsUrl);
// Only the hotel's own PMS over HTTPS (the exact host is in config.json → pmsUrl).
if (endpoint.protocol !== 'https:' || !/(^|\.)hotelcorali\.gr$/.test(endpoint.hostname) || endpoint.pathname !== '/api/gateway/tv-privacy') throw new Error('UNTRUSTED_PMS_ENDPOINT');
const roomMap = conf.roomMap ?? {};
// The two newly identified apps must be explicitly enabled by the operator after pilot verification.
if (conf.dryRun === false && conf.unverifiedAppPilotsApproved !== true) {
  throw new Error('LIVE_DISABLED_UNTIL_DISNEY_AND_YTMUSIC_PILOTS_APPROVED');
}

for (const [roomId,item] of Object.entries(roomMap)) {
  if (!/^[1-9][0-9]*$/.test(roomId) || !/^[0-9a-f]{16}$/i.test(item.androidId)) throw new Error('BAD_ROOM_MAPPING');
}
const pause = ms => new Promise(r=>setTimeout(r,ms));
// Each TV's baseline of third-party packages (hotel apps); additions are reported as guest-installed apps.
function baselineFor(mapping) {
  const file = path.resolve(here, '..', mapping?.baselineFile || 'baseline/tv112-third-party-baseline.txt');
  return fs.existsSync(file) ? parseThirdPartyPackages(fs.readFileSync(file,'utf8')) : null;
}
async function api(body) {
  const response = await fetch(endpoint.href, {method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify(body),signal:AbortSignal.timeout(15000),cache:'no-store'});
  if (!response.ok) throw new Error(`PMS_HTTP_${response.status}`);
  return response.json();
}
async function runOne(job) {
  const mapping = roomMap[String(job.roomId)];
  if (!isSafeJob(job,mapping)) {
    console.error('UNMAPPED_ROOM_OR_INVALID_JOB',job?.id);
    // Fail closed; not authorized to wipe unidentified hardware. Report blocked if lease exists.
    if (job?.leaseToken) await api({op:'report',jobId:job.id,leaseToken:job.leaseToken,results:[],dryRun:!!conf.dryRun,securityBlocked:true});
    return;
  }
  const adapter = createAdbAdapter({adbPath,serial:mapping.serial,androidId:mapping.androidId});
  const results=[];
  try {
    await adapter.assertIdentity();
    for (const pkg of APPROVED_PACKAGES) {
      // Re-authorize before EVERY destructive command to reduce stale-job risk.
      const permit = await api({op:'authorize',jobId:job.id,leaseToken:job.leaseToken});
      if (!permit.allowed) { console.warn('JOB_NOT_AUTHORIZED',job.id); return; }
      try {
        results.push(normalizeAppResult(await adapter.clearPackage(pkg,{dryRun: conf.dryRun !== false})));
      } catch(e) {
        const code = String(e?.message||'FAILED');
        results.push({package:pkg,status: code==='ANDROID_ID_MISMATCH'?'BLOCKED_SECURITY':'FAILED', code: code==='ANDROID_ID_MISMATCH'?'ANDROID_ID_MISMATCH':'ADB_OPERATION_FAILED'});
        if (code==='ANDROID_ID_MISMATCH') break;
      }
    }
  } catch {
    console.error('ADB_PREFLIGHT_FAILED',job.id);
    // Never turn untested or unverified execution into success.
    results.push({package:APPROVED_PACKAGES[0],status:'FAILED',code:'ADB_PREFLIGHT_FAILED'});
  }
  const safe=results.map(normalizeAppResult);
  const state=classifyResults(safe,conf.dryRun !== false);
  // Guest-installed apps: reported for an admin to decide; never removed here.
  let addedPackages=[];
  try {
    const baseline=baselineFor(mapping);
    if (baseline && state!=='BLOCKED_SECURITY') addedPackages=addedThirdPartyPackages(baseline,parseThirdPartyPackages(await adapter.listThirdPartyPackages()));
  } catch { addedPackages=[]; }
  const report=await api({op:'report',jobId:job.id,leaseToken:job.leaseToken,results:safe,dryRun: conf.dryRun !== false,securityBlocked:state==='BLOCKED_SECURITY',addedPackages});
  console.log(new Date().toISOString(),'job',job.id,'status',report.status);
}
// An admin-approved removal of one guest-installed app (PMS → Corali TV). Dry-run never removes anything.
async function runUninstall(task) {
  const mapping = roomMap[String(task.roomId)];
  let result = {status:'BLOCKED_SECURITY',code:'UNMAPPED_ROOM'};
  if (mapping && /^[0-9a-f]{16}$/i.test(mapping.androidId) && /^[0-9a-f]{64}$/.test(task.leaseToken)) {
    try {
      const adapter = createAdbAdapter({adbPath,serial:mapping.serial,androidId:mapping.androidId});
      result = conf.dryRun !== false ? {status:'FAILED',code:'DRY_RUN_NO_REMOVAL'} : await adapter.uninstallPackage(task.package, baselineFor(mapping) ?? []);
    } catch (e) { result = {status:String(e?.message)==='ANDROID_ID_MISMATCH'?'BLOCKED_SECURITY':'FAILED',code:String(e?.message)==='ANDROID_ID_MISMATCH'?'ANDROID_ID_MISMATCH':'ADB_OPERATION_FAILED'}; }
  }
  const safe=normalizeUninstallResult(result);
  await api({op:'report_uninstall',taskId:task.id,leaseToken:task.leaseToken,...safe});
  console.log(new Date().toISOString(),'uninstall',task.id,safe.status);
}
console.log('Corali TV privacy gateway started; dryRun=',conf.dryRun !== false);
while(true) {
  try {
    const claimed=await api({op:'claim',dryRun:conf.dryRun !== false});
    if(claimed.job) await runOne(claimed.job);
    const removal=await api({op:'claim_uninstall'});
    if(removal.task) await runUninstall(removal.task);
  } catch(e) { console.error(new Date().toISOString(),'WORKER_ERROR',String(e?.message).slice(0,100)); }
  await pause(Math.max(10,Math.min(300,Number(conf.pollSeconds)||20))*1000);
}
