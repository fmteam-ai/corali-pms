"use client";
import { useRouter } from "next/navigation";
import { pmsLangCookie, type PmsLang } from "@/lib/pms-i18n";

function persistLang(next: PmsLang) {
  document.cookie = `${pmsLangCookie}=${next}; path=/; max-age=31536000; SameSite=Strict${location.protocol === "https:" ? "; Secure" : ""}`;
  document.documentElement.lang = next;
}

export function LangToggle({ lang, label }: { lang: PmsLang; label: string }) {
  const router = useRouter();
  function choose(next: PmsLang) {
    if (next === lang) return;
    persistLang(next);
    router.refresh();
  }
  return (
    <div className="langToggle" role="group" aria-label={label}>
      {(["el", "en"] as const).map((code) => (
        <button key={code} type="button" aria-pressed={lang === code} onClick={() => choose(code)}>{code.toUpperCase()}</button>
      ))}
    </div>
  );
}
