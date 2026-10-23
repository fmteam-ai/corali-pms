import QRCode from "qrcode";
import { requireUser } from "@/lib/auth";
import { listScreens, loadTvSettings } from "@/lib/tv";
import { PrintButton } from "./print-button";

/** Printable QR cards, one per room, for the bedside table: the same page as the TV, on the guest's phone. */
export default async function TvCardsPage() {
  const u = await requireUser("integrations.read");
  const [screens, settings] = await Promise.all([listScreens(u.ownerId), loadTvSettings(u.ownerId)]);
  const cards = await Promise.all(screens.filter((s) => s.active === 1).map(async (s) => ({ ...s, qr: await QRCode.toDataURL(s.url, { errorCorrectionLevel: "M", margin: 1, width: 420, color: { dark: "#173e47", light: "#ffffff" } }) })));
  return (
    <section className="tvCardsPage">
      <div className="pageTitle noPrint"><div><h1>QR cards</h1><p>Print on A4 (4 cards per page), cut and place one in each room. Scanning opens the room&apos;s welcome page with Wi-Fi, tips and services.</p></div><PrintButton /></div>
      <div className="tvCards">{cards.map((c) => (
        <article className="tvCardPrint" key={c.room_id}>
          <img src="/hotel-corali-logo.png" alt="Hotel Corali" />
          <img className="qr" src={c.qr} alt="" />
          <p><b>Σκανάρετε για Wi-Fi, πληροφορίες & υπηρεσίες</b><br />Scan for Wi-Fi, hotel info & services</p>
          {settings.wifiSsid && !c.wifi_ssid && <small>Wi-Fi: {settings.wifiSsid}</small>}
          {c.wifi_ssid && <small>Wi-Fi: {c.wifi_ssid}</small>}
          <span className="room">{c.room_code}</span>
        </article>
      ))}</div>
    </section>
  );
}
