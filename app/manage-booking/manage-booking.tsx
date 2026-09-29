"use client";
import {useCallback,useEffect,useState} from "react";
import {bookingLanguage,bookingLocale,type BookingLanguage} from "@/lib/booking-i18n";
import {guestLanguages,guestText} from "@/lib/guest-i18n";
type Data={booking:{reference:string;guest_name:string;check_in:string;check_out:string;status:string;room_code:string;room_type:string;total_cents:number;balance_cents:number};messages:Array<{id:number;sender:string;body:string;created_at:number}>};
export function ManageBooking({token}:{token:string}){
 const[data,setData]=useState<Data|null>(null),[error,setError]=useState(false),[lang,setLang]=useState<BookingLanguage>("en"),[busy,setBusy]=useState(false),[messageError,setMessageError]=useState(false),t=guestText[lang];
 useEffect(()=>{queueMicrotask(()=>setLang(bookingLanguage(new URLSearchParams(location.search).get("lang")??navigator.language)))},[]);
 const load=useCallback(async()=>{try{const r=await fetch(`/api/public/manage-booking?token=${encodeURIComponent(token)}&lang=${lang}`,{cache:"no-store"}),d=await r.json();if(r.ok){setData(d);setError(false)}else setError(true)}catch{setError(true)}},[token,lang]);
 useEffect(()=>{if(token){const id=setTimeout(load,0);return()=>clearTimeout(id)}},[token,load]);
 async function send(f:FormData){setBusy(true);try{const r=await fetch("/api/public/manage-booking",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token,body:f.get("body")})});if(r.ok){setMessageError(false);await load()}else setMessageError(true)}catch{setMessageError(true)}finally{setBusy(false)}}
 const picker=<label className="languagePicker"><span className="sr-only">Language</span><select aria-label="Language" value={lang} onChange={e=>setLang(bookingLanguage(e.target.value))}>{guestLanguages.map(x=><option value={x.code} key={x.code}>{x.name}</option>)}</select></label>;
 if(!token)return <main className="shell"><section className="card">{picker}<h1>{t.manage}</h1><p>{t.linkPrompt}</p></section></main>;
 if(error)return <main className="shell"><section className="card">{picker}<h1>{t.manage}</h1><p className="error">{t.invalidLink}</p></section></main>;
 if(!data)return <main className="shell">{picker}<p>{t.loading}</p></main>;
 const b=data.booking,format=(v:string)=>new Intl.DateTimeFormat(bookingLocale[lang],{day:"numeric",month:"long",year:"numeric",timeZone:"UTC"}).format(new Date(`${v}T12:00:00Z`));
 return <main className="shell"><section className="card manageCard">{picker}<h1>{t.yourBooking}</h1><p><b>{b.reference}</b> · {b.guest_name}</p><dl><dt>{t.room}</dt><dd>{b.room_code} · {b.room_type}</dd><dt>{t.in}</dt><dd>{format(b.check_in)}</dd><dt>{t.out}</dt><dd>{format(b.check_out)}</dd><dt>{t.status}</dt><dd>{t[b.status]??b.status}</dd><dt>{t.balance}</dt><dd>{new Intl.NumberFormat(bookingLocale[lang],{style:"currency",currency:"EUR"}).format(Number(b.balance_cents)/100)}</dd></dl><h2>{t.messages}</h2><div className="thread">{data.messages.map(m=><div className={`bubble ${m.sender}`} key={m.id}><b>{m.sender==="guest"?t.you:"Hotel Corali"}</b><p>{m.body}</p></div>)}</div>{messageError&&<p role="alert" className="error">{t.messageError}</p>}<form action={send} className="messageComposer"><textarea name="body" required maxLength={4000} placeholder={t.write}/><button disabled={busy}>{t.send}</button></form></section></main>
}
