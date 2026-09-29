import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth";
import { LoginForm } from "./login-form";
import Image from "next/image";

export default async function LoginPage() {
  if (await currentUser()) redirect("/pms");
  return <main className="shell"><section className="card loginCard"><Image className="loginLogo" src="/hotel-corali-logo.png" alt="Hotel Corali" width={602} height={151} priority/><p className="eyebrow">PROPERTY MANAGEMENT SYSTEM</p><h1>Σύνδεση</h1><LoginForm /></section></main>;
}
