import {requireUser} from "@/lib/auth";
import {db} from "@/lib/db";
import {getPmsT} from "@/lib/pms-lang";
import {MessagesManager} from "./messages-manager";
export default async function MessagesPage(){const u=await requireUser("reservations.read");const {lang,t}=await getPmsT();const r=await db().query(`SELECT m.id,m.booking_id,m.sender,m.body,m.read_at,m.email_notified,m.created_at,b.reference,b.guest_name,b.guest_email FROM booking_messages m JOIN bookings b ON b.owner_id=m.owner_id AND b.id=m.booking_id WHERE m.owner_id=$1 ORDER BY m.created_at DESC LIMIT 300`,[u.ownerId]);return <section><div className="pageTitle"><div><h1>{t("msg.title")}</h1><p>{t("msg.subtitle")}</p></div></div>{r.rowCount?<MessagesManager lang={lang} initial={r.rows}/>:<p>{t("msg.empty")}</p>}</section>}
