"use client";
import { useState } from "react";
import { providerFields, type ProviderKey } from "@/lib/provider-fields";

type ProviderView={providerKey:ProviderKey;label:string;active:boolean;status:string;settings:Record<string,string>;secretConfigured:Record<string,boolean>;lastTestAt:number|null;lastTestResult:string|null};
const names:Record<string,string>={publishableKey:"Publishable key",secretKey:"Secret key",webhookSecret:"Webhook signing secret",merchantId:"Merchant ID",sourceCode:"Source code",clientId:"Client ID",clientSecret:"Client secret",phoneNumberId:"Phone number ID",businessAccountId:"Business account ID",apiVersion:"Graph API version (π.χ. v26.0)",accessToken:"Access token",verifyToken:"Verify token",appSecret:"App secret",host:"SMTP host",port:"Port",username:"Username",from:"From email",password:"Password",environment:"Environment (demo ή live)",issuerVat:"ΑΦΜ εκδότη",subscriptionKey:"Subscription key",providerToken:"Provider token",appId:"App ID",pageId:"Page ID",pageAccessToken:"Page access token",clientKey:"Client key",propertyCode:"Property code",providerName:"Provider name",apiKey:"API key"};
export function ProviderManager({initial,editable}:{initial:ProviderView[];editable:boolean}){
  const [providers,setProviders]=useState(initial),[selected,setSelected]=useState<ProviderKey>("stripe"),[message,setMessage]=useState("");
  const current=providers.find(p=>p.providerKey===selected)!;
  const fields=providerFields[selected];
  async function refresh(){const response=await fetch("/api/pms/provider-connections",{cache:"no-store"});if(response.ok){const data=await response.json();setProviders(data.providers)}}
  async function save(data:FormData){
    setMessage("");
    const settings=Object.fromEntries(fields.settings.map(key=>[key,String(data.get(key)??"").trim()]));
    const secrets=Object.fromEntries(fields.secrets.map(key=>[key,String(data.get(key)??"").trim()]));
    const clearSecrets=fields.secrets.filter(key=>data.get(`clear_${key}`)==="on");
    const response=await fetch("/api/pms/provider-connections",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({providerKey:selected,active:data.get("active")==="on",settings,secrets,clearSecrets})});
    const result=await response.json();
    setMessage(response.ok?"Αποθηκεύτηκε. Τα μυστικά πεδία δεν εμφανίζονται ξανά.":result.error==="CREDENTIALS_REQUIRED"?"Συμπληρώστε τα απαιτούμενα κλειδιά πριν την ενεργοποίηση.":"Η αποθήκευση απέτυχε.");
    if(response.ok)await refresh();
  }
  async function test(){setMessage("Γίνεται έλεγχος σύνδεσης…");const response=await fetch("/api/pms/provider-connections",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({providerKey:selected})});const result=await response.json();setMessage(response.ok?"Η σύνδεση επαληθεύτηκε.":result.error==="TEST_NOT_AVAILABLE"?"Ο αυτόματος έλεγχος αυτού του παρόχου δεν είναι ακόμη διαθέσιμος.":"Ο έλεγχος σύνδεσης απέτυχε.");await refresh()}
  return <div className="detailGrid"><article><h2>Πάροχοι</h2><div className="integrationGrid">{providers.map(provider=><button type="button" key={provider.providerKey} onClick={()=>{setSelected(provider.providerKey);setMessage("")}} aria-pressed={selected===provider.providerKey}><strong>{provider.label}</strong><br/><small>{provider.status==="verified"?"Επαληθευμένο":provider.active?"Ρυθμισμένο — εκκρεμεί έλεγχος":provider.status==="not_configured"?"Δεν έχει ρυθμιστεί":"Ανενεργό"}</small></button>)}</div></article><article><h2>{current.label}</h2><p>Τα κλειδιά αποθηκεύονται κρυπτογραφημένα. Κενό μυστικό πεδίο διατηρεί την προηγούμενη τιμή.</p><form key={selected+JSON.stringify(current.settings)+JSON.stringify(current.secretConfigured)+current.active} action={save} className="adminForm">
    {fields.settings.map(key=><label key={key}>{names[key]??key}<input name={key} defaultValue={current.settings[key]??""} autoComplete="off"/></label>)}
    {fields.secrets.map(key=><label key={key}>{names[key]??key} {current.secretConfigured[key]?"· αποθηκευμένο":""}<input name={key} type="password" autoComplete="new-password" placeholder={current.secretConfigured[key]?"Κενό = διατήρηση":"Εισαγωγή κλειδιού"}/>{current.secretConfigured[key]&&<span><input type="checkbox" name={`clear_${key}`}/> Διαγραφή αποθηκευμένου κλειδιού</span>}</label>)}
    <label><input type="checkbox" name="active" defaultChecked={current.active}/> Ενεργή ρύθμιση</label>
    <p>Η ενεργοποίηση αποθηκεύει τη ρύθμιση. Η υπηρεσία χρησιμοποιείται μόνο όπου υπάρχει υλοποιημένη σύνδεση και επιτυχής έλεγχος.</p>
    {editable&&<button>Αποθήκευση</button>}
  </form>{editable&&["stripe","smtp","viva","whatsapp"].includes(selected)&&current.active&&<button type="button" onClick={test}>Έλεγχος σύνδεσης</button>}{current.lastTestAt&&<p>Τελευταίος έλεγχος: {new Date(Number(current.lastTestAt)).toLocaleString("el-GR")} · {current.lastTestResult}</p>}<p className="notice" role="status">{message}</p></article></div>
}
