import { redirect } from "next/navigation";

export default function HomePage() {
  redirect(process.env.APP_ROLE === "booking" ? "/book" : "/login");
}
