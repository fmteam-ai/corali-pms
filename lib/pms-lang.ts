import { cookies } from "next/headers";
import { normalizePmsLang, pmsLangCookie, pmsT, type PmsLang } from "@/lib/pms-i18n";

/** Staff UI language from the pms_lang cookie (Greek by default). */
export async function getPmsLang(): Promise<PmsLang> {
  return normalizePmsLang((await cookies()).get(pmsLangCookie)?.value);
}

export async function getPmsT() {
  const lang = await getPmsLang();
  return { lang, t: pmsT(lang) };
}
