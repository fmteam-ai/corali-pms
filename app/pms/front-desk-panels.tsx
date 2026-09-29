import Link from "next/link";
import { pmsLocale, pmsT, type PmsKey, type PmsLang } from "@/lib/pms-i18n";
import { StayBoard, type Stay } from "./stay-board";

type Room={id:number;code:string;room_type:string;operational_status:string;guest_name:string|null;booking_id:number|null;balance_cents:number|null};
type Balance={id:number;reference:string;guest_name:string;check_in:string;check_out:string;balance_cents:number};
type Service={id:number;name:string;price_cents:number;pricing_mode:string};
type Task={id:number;room_code:string;status:string;task_type:string;assigned_to:string|null};

export function FrontDeskPanels({lang,canEdit,stays,rooms,balances,services,tasks,holds,paymentsToday,showFinancial}:{lang:PmsLang;canEdit:boolean;stays:Record<"today"|"tomorrow",{arrivals:Stay[];departures:Stay[]}>;rooms:Room[];balances:Balance[];services:Service[];tasks:Task[];holds:number;paymentsToday:number;showFinancial:boolean}){
 const t=pmsT(lang);
 const money=(v:number)=>new Intl.NumberFormat(pmsLocale(lang),{style:"currency",currency:"EUR"}).format(Number(v)/100);
 const roomLabel=(status:string)=>{const key=`room.${status}` as PmsKey;return t(key)===key?status:t(key)};
 const occupied=rooms.filter(r=>r.booking_id!==null).length;
 const unavailable=rooms.filter(r=>r.operational_status==="out_of_order"&&r.booking_id===null).length;
 return <section className="frontDesk"><div className="frontDeskHeading"><h2>{t("desk.title")}</h2><p>{t("desk.subtitle")}</p></div>
  <div className="deskSummary"><div><small>{t("desk.occupied")}</small><strong>{occupied}</strong></div><div><small>{t("desk.vacant")}</small><strong>{rooms.length-occupied-unavailable}</strong></div><div><small>{t("desk.outOfOrder")}</small><strong>{unavailable}</strong></div><div><small>{t("desk.openTasks")}</small><strong>{tasks.length}</strong></div>{showFinancial&&<div><small>{t("desk.netReceipts")}</small><strong>{money(paymentsToday)}</strong></div>}</div>
  <StayBoard lang={lang} stays={stays} canEdit={canEdit} showFinancial={showFinancial}/>
  <div className="frontDeskColumns"><article><h3>{t("desk.roomsNow",{n:rooms.length})}</h3><div className="deskRooms">{rooms.map(r=><Link key={r.id} href={r.booking_id?`/pms/reservations/${r.booking_id}`:"/pms/rooms"} className={`deskRoom ${r.operational_status}`}><strong>{r.code}</strong><small>{r.room_type}</small><span>{r.guest_name??roomLabel(r.operational_status)}</span></Link>)}</div></article>
  <article><h3>{t("desk.tasks",{n:tasks.length})}</h3>{tasks.slice(0,12).map(task=><Link className="deskRow" href="/pms/housekeeping" key={task.id}><strong>{task.room_code} · {task.task_type}</strong><span>{task.status} · {task.assigned_to??t("desk.unassigned")}</span></Link>)}{!tasks.length&&<p>{t("desk.noTasks")}</p>}<p>{t("desk.holds")} <strong>{holds}</strong></p></article></div>
  <div className="frontDeskColumns">{showFinancial&&<article><h3>{t("desk.unpaid",{n:`${balances.length}${balances.length===50?"+":""}`})}</h3>{balances.slice(0,12).map(b=><Link className="deskRow" href={`/pms/reservations/${b.id}`} key={b.id}><strong>{b.guest_name}</strong><small>{b.reference} · {b.check_in} → {b.check_out}</small><span>{money(b.balance_cents)}</span></Link>)}{!balances.length&&<p>{t("desk.noUnpaid")}</p>}</article>}
  <article><h3>{t("desk.extras",{n:services.length})}</h3>{services.map(x=><Link className="deskRow" href="/pms/rooms/catalog" key={x.id}><strong>{x.name}</strong><span>{money(x.price_cents)} · {x.pricing_mode}</span></Link>)}{!services.length&&<p>{t("desk.noExtras")}</p>}</article></div></section>
}
