import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { getPmsT } from "@/lib/pms-lang";
import { LangToggle } from "@/app/pms/lang-toggle";
import { LoginForm } from "./login-form";
import Image from "next/image";
import "@/app/pms/pms-theme.css";

export default async function LoginPage() {
  const user = await currentUser();
  if (user) redirect(user.role === "housekeeping" ? "/hk" : "/pms");
  const { lang, t } = await getPmsT();
  return (
    <main className="loginPage" lang={lang}>
      <figure className="loginPhoto" aria-hidden="true">
        <Image src="/images/corali-harbour.jpg" alt="" fill sizes="60vw" priority />
        <figcaption><b>Hotel Corali</b><span>Πίσω Λιβάδι · Πάρος · Piso Livadi, Paros</span></figcaption>
      </figure>
      <div className="loginSide">
        <section className="loginCard">
          <div className="loginLang"><LangToggle lang={lang} label={t("app.language")}/></div>
          <Image className="loginLogo" src="/hotel-corali-logo.png" alt="Hotel Corali" width={602} height={151} priority/>
          <p className="eyebrow">PROPERTY MANAGEMENT SYSTEM</p>
          <h1>{t("login.title")}</h1>
          <LoginForm lang={lang} />
        </section>
      </div>
    </main>
  );
}
