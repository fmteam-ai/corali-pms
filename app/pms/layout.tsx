import Link from "next/link";
import Image from "next/image";
import {requireUser} from "@/lib/auth";
import {can,type Permission} from "@/lib/security/permissions";
import {getPmsT} from "@/lib/pms-lang";
import type {PmsKey} from "@/lib/pms-i18n";
import {UserMenu} from "./user-menu";
import {NotificationBell} from "./notification-bell";
import {LangToggle} from "./lang-toggle";
import {QuickSearch} from "./quick-search";

const sections:{title:PmsKey;items:{href:string;label:PmsKey;permission:Permission}[]}[]=[
 {title:"nav.work",items:[{href:"/pms",label:"nav.overview",permission:"dashboard.read"},{href:"/pms/reservations",label:"nav.reservations",permission:"reservations.read"},{href:"/pms/rooms",label:"nav.roomPlan",permission:"rooms.read"},{href:"/pms/housekeeping",label:"nav.housekeeping",permission:"housekeeping.read"},{href:"/pms/maintenance",label:"nav.maintenance",permission:"housekeeping.read"},{href:"/pms/messages",label:"nav.messages",permission:"reservations.read"}]},
 {title:"nav.management",items:[{href:"/pms/guests",label:"nav.guests",permission:"reservations.read"},{href:"/pms/feedback",label:"nav.feedback",permission:"reservations.read"},{href:"/pms/rooms/catalog",label:"nav.catalog",permission:"rooms.read"},{href:"/pms/pricing",label:"nav.pricing",permission:"pricing.read"},{href:"/pms/reports",label:"nav.reports",permission:"reports.read"}]},
 {title:"nav.settings",items:[{href:"/pms/integrations",label:"nav.integrations",permission:"integrations.read"},{href:"/pms/automations",label:"nav.automations",permission:"integrations.read"},{href:"/pms/arrival",label:"nav.arrival",permission:"integrations.read"},{href:"/pms/widgets",label:"nav.widgets",permission:"integrations.read"},{href:"/pms/social",label:"nav.social",permission:"integrations.read"},{href:"/pms/translations",label:"nav.translations",permission:"dashboard.read"},{href:"/pms/users",label:"nav.users",permission:"users.manage"},{href:"/pms/audit",label:"nav.audit",permission:"audit.read"},{href:"/pms/profile",label:"nav.profile",permission:"dashboard.read"}]},
];
export default async function PmsLayout({children}:Readonly<{children:React.ReactNode}>){
 const user=await requireUser("dashboard.read");
 const {lang,t}=await getPmsT();
 return <div className="pms" lang={lang}><aside className="pmsSidebar"><Link href="/pms" className="pmsIdentity" aria-label={`${t("app.name")} · ${t("nav.overview")}`}><span className="pmsLogoPanel"><Image src="/hotel-corali-logo.png" alt="Hotel Corali" width={602} height={151} priority/></span></Link><nav aria-label={t("app.mainMenu")}>{sections.map(section=><div className="navGroup" key={section.title}><b>{t(section.title)}</b>{section.items.filter(item=>can(user.role,item.permission,user.permissions)).map(item=><Link key={item.href} href={item.href}>{t(item.label)}</Link>)}</div>)}</nav></aside><div className="pmsBody"><header className="pmsTopbar"><div><strong>{t("app.name")}</strong><small>{t("app.location")}</small></div>{can(user.role,"reservations.read",user.permissions)&&<QuickSearch lang={lang}/>}<div className="pmsTopActions">{can(user.role,"reservations.create",user.permissions)&&<Link href="/pms/reservations/new">{t("app.newReservation")}</Link>}<LangToggle lang={lang} label={t("app.language")}/><NotificationBell lang={lang}/><UserMenu name={user.displayName} logoutLabel={t("app.logout")}/></div></header><main>{children}</main></div></div>
}
