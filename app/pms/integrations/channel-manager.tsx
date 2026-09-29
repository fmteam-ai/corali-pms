"use client";
import { useState } from "react";
type Channel={provider_key:string;name:string;status:string;active:number;property_code:string;provider_endpoint:string};
export function ChannelManager({channels}:{channels:Channel[]}){
  const [message,setMessage]=useState("");
  async function save(form:FormData){
    const response=await fetch("/api/pms/integrations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({providerKey:form.get("providerKey"),name:form.get("name"),propertyCode:form.get("propertyCode"),endpoint:form.get("endpoint"),active:form.get("active")==="on"})});
    setMessage(response.ok?"Οι ρυθμίσεις καναλιού αποθηκεύτηκαν.":"Ελέγξτε το property code, endpoint και τα στοιχεία του Channel Manager.");
  }
  return <section><h2>Κανάλια OTA</h2><p>Οι ρυθμίσεις καναλιών δεν ενεργοποιούν αυτόματο συγχρονισμό μέχρι να ολοκληρωθεί η σύνδεση με τον επιλεγμένο provider.</p>
    {channels.map(channel=><form key={channel.provider_key} className="adminForm" action={save}><input type="hidden" name="providerKey" value={channel.provider_key}/><input name="name" defaultValue={channel.name} aria-label="Όνομα καναλιού"/><input name="propertyCode" defaultValue={channel.property_code} placeholder="Property code"/><input name="endpoint" defaultValue={channel.provider_endpoint} placeholder="API endpoint"/><label><input type="checkbox" name="active" defaultChecked={Boolean(channel.active)}/> Ενεργό</label><button>Αποθήκευση</button></form>)}
    <form className="adminForm" action={save}><select name="providerKey"><option value="booking_com">Booking.com</option><option value="expedia">Expedia</option><option value="airbnb">Airbnb</option><option value="other">Άλλο</option></select><input name="name" placeholder="Όνομα σύνδεσης" required/><input name="propertyCode" placeholder="Property code"/><input name="endpoint" placeholder="API endpoint"/><label><input type="checkbox" name="active"/> Ενεργό</label><button>Προσθήκη</button></form><p role="status">{message}</p>
  </section>;
}
