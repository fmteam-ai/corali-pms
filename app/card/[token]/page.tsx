import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { cardForToken } from "@/lib/access-cards";
import { walletImageUrl } from "@/lib/wallet-images";
import { appleReady, googleReady, stayDates } from "@/lib/wallet-passes";
import { cardTexts, when } from "../../../scripts/access-card-core.mjs";
import "./card.css";

export const metadata: Metadata = { title: "Hotel Corali · Digital key", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

/** The guest's digital key: the card itself (name, room, validity, QR) and the Apple / Google Wallet buttons. */
export default async function CardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const found = await cardForToken(token);
  if (!found || !found.enabled) notFound();
  const { card, state, wallet, secrets } = found, t = cardTexts[card.lang as keyof typeof cardTexts] ?? cardTexts.en;
  const live = state === "active" || state === "scheduled";
  const qr = live ? await QRCode.toDataURL(card.credential, { errorCorrectionLevel: "M", margin: 1, width: 360, color: { dark: "#173e47", light: "#ffffff" } }) : null;
  const apple = live && appleReady(wallet, secrets), google = live && googleReady(wallet, secrets);
  return (
    <main className="keyPage" lang={card.lang}>
      {/* Like a bank card: the hotel photo edge to edge, logo, stay dates, the contactless mark; then the room panel. */}
      <article className={`keyBank st-${state}`} style={{ backgroundImage: `url(${walletImageUrl(found.photo, "card")})` }} aria-label={`Hotel Corali · ${t.title}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="keyLogo" src="/wallet/logo@2x.png" alt="Hotel Corali" />
        <span className="keyDates"><small>PISO LIVADI · PAROS</small><b>{stayDates(card)}</b></span>
        <span className="keyBrand">Hotel Corali</span>
        <svg className="keyNfc" viewBox="0 0 24 24" aria-hidden><path d="M8.5 7.5a6.5 6.5 0 0 1 0 9M12 5a10 10 0 0 1 0 14M15.5 2.5a13.5 13.5 0 0 1 0 19M5 10a2.8 2.8 0 0 1 0 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
      </article>
      <section className="keyPanel">
        <div className="keyRoomBox">
          {card.roomCode ? <><small>{t.room}</small><b className="keyRoom">{card.roomCode}</b></> : <><small>{t.guest}</small><b className="keyRoom small">{card.holder}</b></>}
          {card.roomCode && <span className="keyHolder">{card.holder}</span>}
        </div>
        {qr ? (
          <div className="keyReader">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="" />
            <small>{t.hint}</small>
          </div>
        ) : <p className="keyState">{state === "revoked" ? t.revoked : t.expired}</p>}
        {state === "scheduled" && <p className="keyState soon">{t.scheduled.replace("{from}", when(card.validFrom, card.lang))}</p>}
        <dl>
          <dt>{t.from}</dt><dd>{when(card.validFrom, card.lang)}</dd>
          <dt>{t.until}</dt><dd>{when(card.validUntil, card.lang)}</dd>
          {card.zones.length > 0 && <><dt>{t.access}</dt><dd>{card.zones.map((z) => z.name).join(" · ")}</dd></>}
        </dl>
        <small className="keySerial">{card.serial}</small>
      </section>
      {live && (
        <div className="keyWallets">
          {apple && <a className="keyApple" href={`/api/public/card/${token}/apple`}><span aria-hidden></span>{t.apple}</a>}
          {google && <a className="keyGoogle" href={`/api/public/card/${token}/google`}>{t.google}</a>}
          {!apple && !google && <p className="keyHint">{t.walletLater}</p>}
        </div>
      )}
    </main>
  );
}
