import Link from "next/link";
import Image from "next/image";
import {currentUser,requireUser} from "@/lib/auth";
import {redirect} from "next/navigation";
import {can,type Permission} from "@/lib/security/permissions";
import {getPmsT} from "@/lib/pms-lang";
import type {PmsKey} from "@/lib/pms-i18n";
import {UserMenu} from "./user-menu";
import {NotificationBell} from "./notification-bell";
import {LangToggle} from "./lang-toggle";
import {QuickSearch} from "./quick-search";
import {TopNav} from "./top-nav";
import {cookies} from "next/headers";
import {ThemeToggle} from "./theme-toggle";
import "./pms-theme.css";
import "./pms-dark.css";
import "./pms-dark-base.css";

type Item={href:string;label:PmsKey;permission:Permission};
// Grouped like a classic hotel back office: settings, rooms, pricing, bookings, management and daily operations.
const groups:{key:string;title:PmsKey;icon:string;items:Item[]}[]=[
 {key:"global",title:"nav.g.global",icon:"global",items:[{href:"/pms/integrations",label:"nav.integrations",permission:"integrations.read"},{href:"/pms/apps",label:"nav.apps",permission:"integrations.read"},{href:"/pms/partners",label:"nav.partners",permission:"integrations.read"},{href:"/pms/api",label:"nav.api",permission:"integrations.read"},{href:"/pms/automations",label:"nav.automations",permission:"integrations.read"},{href:"/pms/arrival",label:"nav.arrival",permission:"integrations.read"},{href:"/pms/tv",label:"nav.tv",permission:"integrations.read"},{href:"/pms/widgets",label:"nav.widgets",permission:"integrations.read"},{href:"/pms/social",label:"nav.social",permission:"integrations.read"},{href:"/pms/translations",label:"nav.translations",permission:"dashboard.read"},{href:"/pms/users",label:"nav.users",permission:"users.manage"},{href:"/pms/audit",label:"nav.audit",permission:"audit.read"},{href:"/pms/profile",label:"nav.profile",permission:"dashboard.read"}]},
 {key:"rooms",title:"nav.g.rooms",icon:"rooms",items:[{href:"/pms/rooms/manage",label:"nav.roomsManage",permission:"rooms.read"},{href:"/pms/rooms/catalog",label:"nav.catalog",permission:"rooms.read"},{href:"/pms/rooms",label:"nav.roomPlan",permission:"rooms.read"},{href:"/pms/rooms/availability-check",label:"nav.availabilityExplain",permission:"reservations.read"},{href:"/pms/room-ac",label:"nav.roomAc",permission:"rooms.read"}]},
 {key:"pricing",title:"nav.g.pricing",icon:"pricing",items:[{href:"/pms/pricing",label:"nav.pricing",permission:"pricing.read"},{href:"/pms/pricing/seasons",label:"nav.seasonRates",permission:"pricing.read"},{href:"/pms/pricing/min-stay",label:"nav.minStay",permission:"pricing.read"},{href:"/pms/pricing/offers",label:"nav.offers",permission:"pricing.read"},{href:"/pms/pricing/coupons",label:"nav.coupons",permission:"pricing.read"},{href:"/pms/pricing/rules",label:"nav.pricingRules",permission:"pricing.read"},{href:"/pms/pricing/suggestions",label:"nav.pricingSuggestions",permission:"pricing.read"},{href:"/pms/pricing/auto",label:"nav.autoPricing",permission:"pricing.read"},{href:"/pms/payment-policy",label:"nav.paymentPolicy",permission:"pricing.read"}]},
 {key:"bookings",title:"nav.g.bookings",icon:"bookings",items:[{href:"/pms/reservations",label:"nav.reservations",permission:"reservations.read"},{href:"/pms/reservations/new",label:"app.newReservation",permission:"reservations.create"},{href:"/pms/guest-orders",label:"nav.guestOrders",permission:"reservations.read"},{href:"/pms/departments",label:"nav.departments",permission:"reservations.read"},{href:"/pms/guest-messages",label:"nav.guestMessages",permission:"reservations.read"},{href:"/pms/access-cards",label:"nav.accessCards",permission:"reservations.read"},{href:"/pms/rooms",label:"nav.roomPlan",permission:"rooms.read"},{href:"/pms/rooms/availability-check",label:"nav.availabilityExplain",permission:"reservations.read"},{href:"/pms/messages",label:"nav.messages",permission:"reservations.read"},{href:"/pms/tv-messages",label:"nav.tvMessages",permission:"reservations.read"}]},
 {key:"management",title:"nav.g.management",icon:"management",items:[{href:"/pms/guests",label:"nav.guests",permission:"reservations.read"},{href:"/pms/feedback",label:"nav.feedback",permission:"reservations.read"},{href:"/pms/payments",label:"nav.payments",permission:"reports.financial"},{href:"/pms/reports",label:"nav.reports",permission:"reports.read"},{href:"/pms/reports/revenue",label:"nav.revenue",permission:"reports.financial"}]},
 {key:"pms",title:"nav.g.pms",icon:"pms",items:[{href:"/pms",label:"nav.overview",permission:"dashboard.read"},{href:"/pms/housekeeping",label:"nav.housekeeping",permission:"housekeeping.read"},{href:"/pms/staff",label:"nav.staff",permission:"users.manage"},{href:"/pms/tv-requests",label:"nav.tvRequests",permission:"housekeeping.read"},{href:"/pms/maintenance",label:"nav.maintenance",permission:"housekeeping.read"}]},
];
export default async function PmsLayout({children}:Readonly<{children:React.ReactNode}>){
 // People without PMS access (e.g. role "staff") use the Corali Staff phone app instead.
 const current=await currentUser();
 if(current&&!can(current.role,"dashboard.read",current.permissions)&&can(current.role,"staff.app",current.permissions))redirect("/staff");
 const user=await requireUser("dashboard.read");
 const {lang,t}=await getPmsT();
 const theme=(await cookies()).get("corali_pms_theme")?.value==="dark"?"dark":"light";
 const navGroups=groups.map(g=>({key:g.key,label:t(g.title),icon:g.icon,items:g.items.filter(i=>can(user.role,i.permission,user.permissions)).map(i=>({href:i.href,label:t(i.label)}))}));
 return <div className="pms pmsTop" lang={lang} data-theme={theme}><header className="pmsTopbar"><Link href="/pms" className="pmsIdentity" aria-label={`${t("app.name")} · ${t("nav.overview")}`}><span className="pmsLogoPanel"><Image src="/hotel-corali-logo.png" alt="Hotel Corali" width={602} height={151} priority/></span></Link><div className="pmsTitle"><strong>{t("app.name")}</strong><small>{t("app.location")}</small></div>{can(user.role,"reservations.read",user.permissions)&&<QuickSearch lang={lang}/>}<div className="pmsTopActions">{can(user.role,"reservations.create",user.permissions)&&<Link href="/pms/reservations/new">{t("app.newReservation")}</Link>}<ThemeToggle initial={theme} labels={{light:t("app.themeLight"),dark:t("app.themeDark")}}/><LangToggle lang={lang} label={t("app.language")}/><NotificationBell lang={lang}/><UserMenu name={user.displayName} logoutLabel={t("app.logout")}/></div></header><TopNav groups={navGroups} menuLabel={t("app.mainMenu")}/><div className="pmsBody"><main>{children}</main></div></div>
}
