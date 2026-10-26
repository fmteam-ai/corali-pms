"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Tabs shared by every Pricing page (the current one is highlighted). */
export function PricingNav({ label, items }: { label: string; items: { href: string; label: string }[] }) {
  const path = usePathname();
  const current = items.filter((i) => path === i.href || path.startsWith(`${i.href}/`)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav className="prcNav" aria-label={label}>
      {items.map((i) => <Link key={i.href} href={i.href} className={i.href === current ? "current" : undefined} aria-current={i.href === current ? "page" : undefined}>{i.label}</Link>)}
    </nav>
  );
}
