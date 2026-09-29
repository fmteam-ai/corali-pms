import {requireUser} from "@/lib/auth";import {ProfileForm} from "./profile-form";
export default async function ProfilePage(){const u=await requireUser("dashboard.read");return <section><h1>Προφίλ χρήστη</h1><ProfileForm displayName={u.displayName} email={u.email}/></section>}
