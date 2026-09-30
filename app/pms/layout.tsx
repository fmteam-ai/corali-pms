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
import {TopNav} from "./top-nav";

type Item={href:string;label:PmsKey;permission:Permission};
// Grouped like a classic hotel back office: settings, rooms, pricing, bookings, management and daily operations.
const groups:{key:string;title:PmsKey;icon:string;items:Item[]}[]=[
 {key:"global",title:"nav.g.global",icon:"⚙️",items:[{href:"/pms/integrations",label:"nav.integrations",permission:"integrations.read"},{href:"/pms/automations",label:"nav.automations",permission:"integrations.read"},{href:"/pms/arrival",label:"nav.arrival",permission:"integrations.read"},{href:"/pms/widgets",label:"nav.widgets",permission:"integrations.read"},{href:"/pms/social",label:"nav.social",permission:"integrations.read"},{href:"/pms/translations",label:"nav.translations",permission:"dashboard.read"},{href:"/pms/users",label:"nav.users",permission:"users.manage"},{href:"/pms/audit",label:"nav.audit",permission:"audit.read"},{href:"/pms/profile",label:"nav.profile",permission:"dashboard.read"}]},
 {key:"rooms",title:"nav.g.rooms",icon:"🛏️",items:[{href:"/pms/rooms/manage",label:"nav.roomsManage",permission:"rooms.read"},{href:"/pms/rooms/catalog",label:"nav.catalog",permission:"rooms.read"},{href:"/pms/rooms",label:"nav.roomPlan",permission:"rooms.read"}]},
 {key:"pricing",title:"nav.g.pricing",icon:"💶",items:[{href:"/pms/pricing",label:"nav.pricing",permission:"pricing.read"},{href:"/pms/pricing/seasons",label:"nav.seasonRates",permission:"pricing.read"},{href:"/pms/pricing/min-stay",label:"nav.minStay",permission:"pricing.read"},{href:"/pms/pricing/rules",label:"nav.pricingRules",permission:"pricing.read"},{href:"/pms/pricing/suggestions",label:"nav.pricingSuggestions",permission:"pricing.read"},{href:"/pms/payment-policy",label:"nav.paymentPolicy",permission:"pricing.read"}]},
 {key:"bookings",title:"nav.g.bookings",icon:"📅",items:[{href:"/pms/reservations",label:"nav.reservations",permission:"reservations.read"},{href:"/pms/reservations/new",label:"app.newReservation",permission:"reservations.create"},{href:"/pms/rooms",label:"nav.roomPlan",permission:"rooms.read"},{href:"/pms/messages",label:"nav.messages",permission:"reservations.read"}]},
 {key:"management",title:"nav.g.management",icon:"📊",items:[{href:"/pms/guests",label:"nav.guests",permission:"reservations.read"},{href:"/pms/feedback",label:"nav.feedback",permission:"reservations.read"},{href:"/pms/payments",label:"nav.payments",permission:"reports.financial"},{href:"/pms/reports",label:"nav.reports",permission:"reports.read"},{href:"/pms/reports/revenue",label:"nav.revenue",permission:"reports.financial"}]},
 {key:"pms",title:"nav.g.pms",icon:"🧹",items:[{href:"/pms",label:"nav.overview",permission:"dashboard.read"},{href:"/pms/housekeeping",label:"nav.housekeeping",permission:"housekeeping.read"},{href:"/pms/maintenance",label:"nav.maintenance",permission:"housekeeping.read"}]},
];
export default async function PmsLayout({children}:Readonly<{children:React.ReactNode}>){
 const user=await requireUser("dashboard.read");
 const {lang,t}=await getPmsT();
 const navGroups=groups.map(g=>({key:g.key,label:t(g.title),icon:g.icon,items:g.items.filter(i=>can(user.role,i.permission,user.permissions)).map(i=>({href:i.href,label:t(i.label)}))}));
 return <div className="pms pmsTop" lang={lang}><header className="pmsTopbar"><Link href="/pms" className="pmsIdentity" aria-label={`${t("app.name")} · ${t("nav.overview")}`}><span className="pmsLogoPanel"><Image src="/hotel-corali-logo.png" alt="Hotel Corali" width={602} height={151} priority/></span></Link><div className="pmsTitle"><strong>{t("app.name")}</strong><small>{t("app.location")}</small></div>{can(user.role,"reservations.read",user.permissions)&&<QuickSearch lang={lang}/>}<div className="pmsTopActions">{can(user.role,"reservations.create",user.permissions)&&<Link href="/pms/reservations/new">{t("app.newReservation")}</Link>}<LangToggle lang={lang} label={t("app.language")}/><NotificationBell lang={lang}/><UserMenu name={user.displayName} logoutLabel={t("app.logout")}/></div></header><TopNav groups={navGroups} menuLabel={t("app.mainMenu")}/><div className="pmsBody"><main>{children}</main></div></div>
}
