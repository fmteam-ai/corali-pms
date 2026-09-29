import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getPmsT } from "@/lib/pms-lang";
import { LangToggle } from "@/app/pms/lang-toggle";
import { LoginForm } from "./login-form";
import Image from "next/image";

export default async function LoginPage() {
  if (await currentUser()) redirect("/pms");
  const { lang, t } = await getPmsT();
  return <main className="shell" lang={lang}><section className="card loginCard"><div className="loginLang"><LangToggle lang={lang} label={t("app.language")}/></div><Image className="loginLogo" src="/hotel-corali-logo.png" alt="Hotel Corali" width={602} height={151} priority/><p className="eyebrow">PROPERTY MANAGEMENT SYSTEM</p><h1>{t("login.title")}</h1><LoginForm lang={lang} /></section></main>;
}
