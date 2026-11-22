import Link from "next/link";
import { salesT } from "@/lib/department-sales-texts";
import type { PmsLang } from "@/lib/pms-i18n";

/** v184: the department pages as one set of tabs (orders, catalogue, messages & offers, sales, sales advisor). */
export function DepartmentTabs({ lang, current }: { lang: PmsLang; current: "sales" | "advisor" }) {
  const t = salesT(lang);
  const links = [
    { href: "/pms/departments", label: t("tabs.orders") }, { href: "/pms/departments?tab=catalog", label: t("tabs.catalog") }, { href: "/pms/guest-messages", label: t("tabs.messages") },
    { href: "/pms/departments/sales", label: t("tabs.sales"), key: "sales" }, { href: "/pms/departments/advisor", label: `💡 ${t("tabs.advisor")}`, key: "advisor" },
  ];
  return <nav className="prcNav">{links.map((l) => <Link key={l.href} href={l.href} className={l.key === current ? "current" : undefined} aria-current={l.key === current ? "page" : undefined}>{l.label}</Link>)}</nav>;
}
