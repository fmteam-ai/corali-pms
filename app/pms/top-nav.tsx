"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type NavGroup = { key: string; label: string; icon: string; items: { href: string; label: string }[] };

/** Horizontal menu with dropdown groups (click or hover), active group highlighted, keyboard and mobile friendly. */
export function TopNav({ groups, menuLabel }: { groups: NavGroup[]; menuLabel: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState<string | null>(null); // opened by hover
  const [pinned, setPinned] = useState<string | null>(null); // opened by click/tap/keyboard
  const [mobile, setMobile] = useState(false);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) { setOpen(null); setPinned(null); }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, []);
  // The longest matching link decides the active group (e.g. /pms/rooms/manage over /pms/rooms).
  const best = groups.flatMap((g) => g.items.map((i) => ({ g: g.key, href: i.href }))).filter((x) => pathname === x.href || (x.href !== "/pms" && pathname.startsWith(`${x.href}/`)) || pathname === x.href).sort((a, b) => b.href.length - a.href.length)[0];
  return (
    <nav className={`pmsNav${mobile ? " mobileOpen" : ""}`} aria-label={menuLabel} ref={ref}>
      <button type="button" className="navBurger" aria-expanded={mobile} onClick={() => setMobile((m) => !m)}>☰ {menuLabel}</button>
      <ul>
        {groups.filter((g) => g.items.length).map((g) => (
          <li key={g.key} className={`${best?.g === g.key ? "active" : ""}${open === g.key || pinned === g.key ? " open" : ""}`} onMouseEnter={() => setOpen(g.key)} onMouseLeave={() => setOpen((o) => (o === g.key ? null : o))}>
            <button type="button" aria-expanded={open === g.key || pinned === g.key} aria-haspopup="true" onClick={() => setPinned((o) => (o === g.key ? null : g.key))}>
              <span aria-hidden="true">{g.icon}</span> {g.label} <span className="caret" aria-hidden="true">▾</span>
            </button>
            <div className="navDrop" role="menu">
              {g.items.map((i) => (
                <Link key={i.href} role="menuitem" href={i.href} className={best?.href === i.href ? "current" : undefined} onClick={() => { setOpen(null); setPinned(null); setMobile(false); }}>{i.label}</Link>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </nav>
  );
}
