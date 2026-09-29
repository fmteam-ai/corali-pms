"use client";
import Link from "next/link";
import {useEffect,useState} from "react";
type Notification={key:string;title:string;created_at:number};
export function NotificationBell(){
  const [open,setOpen]=useState(false),[items,setItems]=useState<Notification[]>([]);
  async function load(){const r=await fetch("/api/pms/dashboard",{cache:"no-store"});if(r.ok){const d=await r.json();setItems(d.notifications??[])}}
  useEffect(()=>{const first=window.setTimeout(load,0),id=window.setInterval(load,60000);return()=>{window.clearTimeout(first);window.clearInterval(id)}},[]);
  async function mark(key:string){const r=await fetch("/api/pms/dashboard",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"read_notification",key})});if(r.ok)setItems(v=>v.filter(x=>x.key!==key))}
  return <div className="bell"><button type="button" aria-label="Ειδοποιήσεις" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>🔔{items.length>0&&<span>{items.length}</span>}</button>{open&&<div className="bellPanel"><strong>Ειδοποιήσεις</strong>{items.length===0?<p>Δεν υπάρχουν νέες ειδοποιήσεις.</p>:items.map(item=><div key={item.key}><Link href={item.key.startsWith("message-")?"/pms/messages":"/pms/reservations"}>{item.title}</Link><button onClick={()=>mark(item.key)}>✓</button></div>)}</div>}</div>
}
