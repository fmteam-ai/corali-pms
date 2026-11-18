"use client";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * A section of the Corali TV page that opens and closes with an arrow; closed by default, remembered per browser.
 * `card`: a whole card (Sound, Standby, …) instead of a part inside one.
 */
export function Fold({ title, count, big, card, children }: { title: string; count?: number; big?: boolean; card?: boolean; children: ReactNode }) {
  const key = `corali.tv.fold.${title}`;
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => { try { if (ref.current && localStorage.getItem(key) === "1") ref.current.open = true; } catch { /* private mode */ } }, [key]);
  return (
    <details ref={ref} className={`tvFold${big || card ? " big" : ""}${card ? " hubCard tvFoldCard" : ""}`} onToggle={(e) => { try { localStorage.setItem(key, e.currentTarget.open ? "1" : "0"); } catch { /* private mode */ } }}>
      <summary>{big || card ? <h2>{title}</h2> : <h3>{title}</h3>}{count !== undefined && <span className="tvFoldCount">{count}</span>}</summary>
      <div className="tvFoldBody">{children}</div>
    </details>
  );
}
