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
    const settings=Object.fromEntries(fields.settings.map(key=>[key,key==="checkoutNote"?JSON.stringify(Object.fromEntries(noteLangs.map(l=>[l,String(data.get(`checkoutNote_${l}`)??"").trim()]).filter(([,v])=>v))):String(data.get(key)??"").trim()]));
    const secrets=Object.fromEntries(fields.secrets.map(key=>[key,String(data.get(key)??"").trim()]));
    const clearSecrets=fields.secrets.filter(key=>data.get(`clear_${key}`)==="on");
    const response=await fetch("/api/pms/provider-connections",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({providerKey:selected,active:data.get("active")==="on",settings,secrets,clearSecrets})});
    const result=await response.json();
    setMessage(response.ok?"Αποθηκεύτηκε. Τα μυστικά πεδία δεν εμφανίζονται ξανά.":result.error==="CREDENTIALS_REQUIRED"?"Συμπληρώστε τα απαιτούμενα κλειδιά πριν την ενεργοποίηση.":"Η αποθήκευση απέτυχε.");
    if(response.ok)await refresh();
  }
  async function test(){setMessage("Γίνεται έλεγχος σύνδεσης…");const response=await fetch("/api/pms/provider-connections",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({providerKey:selected})});const result=await response.json();setMessage(response.ok?"Η σύνδεση επαληθεύτηκε.":result.error==="TEST_NOT_AVAILABLE"?"Ο αυτόματος έλεγχος αυτού του παρόχου δεν είναι ακόμη διαθέσιμος.":"Ο έλεγχος σύνδεσης απέτυχε.");await refresh()}
  return <div className="detailGrid"><article><h2>Πάροχοι</h2><div className="integrationGrid">{providers.map(provider=><button type="button" key={provider.providerKey} onClick={()=>{setSelected(provider.providerKey);setMessage("")}} aria-pressed={selected===provider.providerKey}><strong>{provider.label}</strong><br/><small>{provider.status==="verified"?"Επαληθευμένο":provider.active?"Ρυθμισμένο — εκκρεμεί έλεγχος":provider.status==="not_configured"?"Δεν έχει ρυθμιστεί":"Ανενεργό"}</small></button>)}</div></article><article><h2>{current.label}</h2><p>Τα κλειδιά αποθηκεύονται κρυπτογραφημένα. Κενό μυστικό πεδίο διατηρεί την προηγούμενη τιμή.</p><form key={selected+JSON.stringify(current.settings)+JSON.stringify(current.secretConfigured)+current.active} action={save} className="adminForm">
    {fields.settings.map(key=>selected==="stripe"&&stripeUi[key]?<StripeField key={key} name={key} value={current.settings[key]??""}/>:<label key={key}>{names[key]??key}<input name={key} defaultValue={current.settings[key]??""} autoComplete="off"/></label>)}
    {fields.secrets.map(key=><label key={key}>{names[key]??key} {current.secretConfigured[key]?"· αποθηκευμένο":""}<input name={key} type="password" autoComplete="new-password" placeholder={current.secretConfigured[key]?"Κενό = διατήρηση":"Εισαγωγή κλειδιού"}/>{current.secretConfigured[key]&&<span><input type="checkbox" name={`clear_${key}`}/> Διαγραφή αποθηκευμένου κλειδιού</span>}</label>)}
    <label><input type="checkbox" name="active" defaultChecked={current.active}/> Ενεργή ρύθμιση</label>
    <p>Η ενεργοποίηση αποθηκεύει τη ρύθμιση. Η υπηρεσία χρησιμοποιείται μόνο όπου υπάρχει υλοποιημένη σύνδεση και επιτυχής έλεγχος.</p>
    {editable&&<button>Αποθήκευση</button>}
  </form>{editable&&["stripe","smtp","viva","whatsapp"].includes(selected)&&current.active&&<button type="button" onClick={test}>Έλεγχος σύνδεσης</button>}{current.lastTestAt&&<p>Τελευταίος έλεγχος: {new Date(Number(current.lastTestAt)).toLocaleString("el-GR")} · {current.lastTestResult}</p>}<p className="notice" role="status">{message}</p></article></div>
}

const noteLangs=["el","en","fr","de","it","es"] as const;
// Stripe Checkout options (VikBooking-style): label, choices (first = default) and explanation.
const stripeUi:Record<string,{label:string;help:string;choices?:[string,string][];kind?:"text"|"textarea"|"note"}>={
  paymentType:{label:"Τύπος πληρωμής (Payment Type)",choices:[["capture","Capture · άμεση χρέωση"],["authorization","Authorization · δέσμευση ποσού"],["off_session","Off Session · μόνο αποθήκευση κάρτας"]],help:"Capture: χρεώνεται αμέσως το ποσό που ορίζει η πολιτική πληρωμής. Authorization: το ποσό δεσμεύεται στην κάρτα (έως 7 ημέρες) και το εισπράττετε ή το αποδεσμεύετε από την κράτηση στο PMS. Off Session: καμία χρέωση τώρα (€0)· η κάρτα αποθηκεύεται και τη χρεώνετε όποτε θέλετε από την κράτηση (Virtual Terminal)."},
  submitType:{label:"Είδος συναλλαγής (Transaction Type)",choices:[["book","Booking · κουμπί «Κράτηση»"],["pay","Pay · κουμπί «Πληρωμή»"],["auto","Auto"]],help:"Το κείμενο του κουμπιού στη σελίδα πληρωμής της Stripe. Η μεταφορά στη σελίδα πληρωμής γίνεται πάντα αυτόματα."},
  automaticMethods:{label:"Αυτόματοι τρόποι πληρωμής",choices:[["yes","Ναι"],["no","Όχι · μόνο κάρτες"]],help:"Η Stripe προτείνει και άλλους τρόπους (Apple Pay, Google Pay κ.λπ.) που έχετε ενεργοποιήσει στο Stripe Dashboard."},
  futureUsage:{label:"Αποθήκευση κάρτας για μελλοντική χρήση (Set up Future Usage)",choices:[["no","Μόνο όταν χρειάζεται (αυτόματη είσπραξη υπολοίπου)"],["yes","Πάντα"]],help:"Με «Πάντα» μπορείτε να χρεώσετε αργότερα την κάρτα από την κράτηση. Κάποιοι τρόποι (π.χ. Klarna) δεν αποθηκεύονται και η Stripe τους κρύβει."},
  extendedAuth:{label:"Extended authorization",choices:[["no","Όχι"],["yes","Ναι"]],help:"Μόνο με Authorization: μεγαλύτερη διάρκεια δέσμευσης (έως 30 ημέρες) όπου το υποστηρίζει η κάρτα."},
  companyName:{label:"Όνομα επιχείρησης (Company Name)",kind:"text",help:"Εμφανίζεται στη γραμμή της χρέωσης στη σελίδα πληρωμής."},
  imageUrl:{label:"Εικόνα (Image URL)",kind:"text",help:"Διεύθυνση https εικόνας που εμφανίζεται κατά την πληρωμή, π.χ. το λογότυπο."},
  metadata:{label:"Metadata",kind:"textarea",help:"Πρόσθετες πληροφορίες προς την πληρωμή, μία ανά γραμμή: κλειδί=τιμή (έως 10)."},
  feeMode:{label:"Χρέωση / Έκπτωση πληρωμής με κάρτα (Charge/Discount)",choices:[["none","Καμία"],["charge","Χρέωση +"],["discount","Έκπτωση −"]],help:"Υπολογίζεται στο συνολικό ποσό της κράτησης και φαίνεται με μικρά γράμματα κάτω από το «Σύνολο κράτησης». Προστίθεται στο folio ως «Χρέωση επεξεργασίας κάρτας»."},
  feeValue:{label:"Αξία χρέωσης / έκπτωσης",kind:"text",help:"Π.χ. 2.48 (ποσοστό, έως 20%) ή 1.50 (ευρώ)."},
  feeType:{label:"Μονάδα",choices:[["percent","%"],["fixed","€ (σταθερό ποσό)"]],help:"Ποσοστό επί του συνόλου ή σταθερό ποσό ανά κράτηση."},
  checkoutNote:{label:"Σημείωση κάτω από το κουμπί πληρωμής (φόρμα κράτησης)",kind:"note",help:"Κενό = «All payments are processed through the Stripe gateway. Hotel Corali will not store any card information.» μεταφρασμένο, και εξήγηση για Authorization / Off Session. Το {gateway} αντικαθίσταται με την πύλη πληρωμών που χρησιμοποιείται."},
};
function StripeField({name,value}:{name:string;value:string}){
  const ui=stripeUi[name];
  let note:Record<string,string>={};if(ui.kind==="note")try{const p=JSON.parse(value||"{}");if(p&&typeof p==="object")note=p}catch{note={}}
  return <div className="stripeOption"><b>{ui.label}</b>
    {ui.choices?<select name={name} defaultValue={value||ui.choices[0][0]}>{ui.choices.map(([v,l])=><option key={v} value={v}>{l}</option>)}</select>
    :ui.kind==="textarea"?<textarea name={name} rows={3} defaultValue={value} placeholder="source=website"/>
    :ui.kind==="note"?<div className="stripeNotes">{noteLangs.map(l=><label key={l}><span>{l.toUpperCase()}</span><textarea name={`checkoutNote_${l}`} rows={2} maxLength={600} defaultValue={note[l]??""}/></label>)}</div>
    :<input name={name} defaultValue={value} autoComplete="off" placeholder={name==="imageUrl"?"https://":name==="feeValue"?"2.48":"HOTEL CORALI"}/>}
    <small>{ui.help}</small></div>;
}
