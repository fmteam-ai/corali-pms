import Link from "next/link";
import {requireUser} from "@/lib/auth";
import {db} from "@/lib/db";
import {getPmsT} from "@/lib/pms-lang";
import {pmsLocale} from "@/lib/pms-i18n";
import {can} from "@/lib/security/permissions";
import {UsersManager} from "./users-manager";

export default async function UsersPage(){
 const u=await requireUser("users.manage");
 const {lang,t}=await getPmsT();
 const [r,audit]=await Promise.all([
  db().query(`SELECT id,username,display_name,email,role,active,permissions_json,(totp_confirmed_at IS NOT NULL) AS two_factor FROM pms_staff_users WHERE owner_id=$1 ORDER BY display_name`,[u.ownerId]),
  db().query(`SELECT a.action,a.created_at,actor.display_name actor_name,target.display_name target_name FROM pms_user_audit a LEFT JOIN pms_staff_users actor ON actor.owner_id=a.owner_id AND actor.id=a.actor_id LEFT JOIN pms_staff_users target ON target.owner_id=a.owner_id AND target.id=a.target_user_id WHERE a.owner_id=$1 ORDER BY a.id DESC LIMIT 30`,[u.ownerId]),
 ]);
 return <section><div className="pageTitle"><div><h1>{t("users.title")}</h1><p>{t("users.subtitle")}</p></div>{can(u.role,"audit.read",u.permissions)&&<Link className="secondaryLink" href="/pms/audit">{t("users.auditLink")}</Link>}</div>
  <UsersManager lang={lang} initial={r.rows} currentUserId={u.id}/>
  <article className="wide"><h2>{t("users.recent")}</h2><ul>{audit.rows.map((entry,i)=><li key={i}>{new Date(Number(entry.created_at)).toLocaleString(pmsLocale(lang))} · {entry.actor_name} · {entry.action} · {entry.target_name}</li>)}</ul></article></section>
}
