import Link from "next/link";
import Image from "next/image";
import {requireUser} from "@/lib/auth";
import {can,type Permission} from "@/lib/security/permissions";
import {UserMenu} from "./user-menu";
import {NotificationBell} from "./notification-bell";

const sections:{title:string;items:{href:string;label:string;permission:Permission}[]}[]=[
 {title:"Εργασίες",items:[{href:"/pms",label:"Επισκόπηση",permission:"dashboard.read"},{href:"/pms/reservations",label:"Κρατήσεις",permission:"reservations.read"},{href:"/pms/rooms",label:"Πλάνο δωματίων",permission:"rooms.read"},{href:"/pms/housekeeping",label:"Housekeeping",permission:"housekeeping.read"},{href:"/pms/messages",label:"Μηνύματα",permission:"reservations.read"}]},
 {title:"Διαχείριση",items:[{href:"/pms/guests",label:"Πελάτες",permission:"reservations.read"},{href:"/pms/rooms/catalog",label:"Δωμάτια & χαρακτηριστικά",permission:"rooms.read"},{href:"/pms/pricing",label:"Τιμές & προσφορές",permission:"pricing.read"},{href:"/pms/reports",label:"Αναφορές",permission:"reports.read"}]},
 {title:"Ρυθμίσεις",items:[{href:"/pms/integrations",label:"Συνδέσεις",permission:"integrations.read"},{href:"/pms/automations",label:"Αυτόματα μηνύματα",permission:"integrations.read"},{href:"/pms/widgets",label:"Widgets & ενσωμάτωση",permission:"integrations.read"},{href:"/pms/translations",label:"Μεταφράσεις Booking",permission:"dashboard.read"},{href:"/pms/users",label:"Χρήστες & δικαιώματα",permission:"users.manage"},{href:"/pms/profile",label:"Το προφίλ μου",permission:"dashboard.read"}]},
];
export default async function PmsLayout({children}:Readonly<{children:React.ReactNode}>){
 const user=await requireUser("dashboard.read");
 return <div className="pms"><aside className="pmsSidebar"><Link href="/pms" className="pmsIdentity" aria-label="Hotel Corali PMS · Επισκόπηση"><span className="pmsLogoPanel"><Image src="/hotel-corali-logo.png" alt="Hotel Corali" width={602} height={151} priority/></span></Link><nav aria-label="Κύριο μενού PMS">{sections.map(section=><div className="navGroup" key={section.title}><b>{section.title}</b>{section.items.filter(item=>can(user.role,item.permission,user.permissions)).map(item=><Link key={item.href} href={item.href}>{item.label}</Link>)}</div>)}</nav></aside><div className="pmsBody"><header className="pmsTopbar"><div><strong>Hotel Corali PMS</strong><small>Πίσω Λιβάδι · Πάρος</small></div><div className="pmsTopActions">{can(user.role,"reservations.create",user.permissions)&&<Link href="/pms/reservations/new">+ Νέα κράτηση</Link>}<NotificationBell/><UserMenu name={user.displayName}/></div></header><main>{children}</main></div></div>
}
