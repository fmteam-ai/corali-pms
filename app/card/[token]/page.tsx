import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { cardForToken } from "@/lib/access-cards";
import { appleReady, googleReady } from "@/lib/wallet-passes";
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
      <article className={`keyCard st-${state}`}>
        <header>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/hotel-corali-logo.png" alt="Hotel Corali" />
          <span>{t.title}</span>
        </header>
        <div className="keyHolder"><small>{t.guest}</small><b>{card.holder}</b></div>
        <dl>
          {card.roomCode && <><dt>{t.room}</dt><dd className="keyRoom">{card.roomCode}</dd></>}
          <dt>{t.from}</dt><dd>{when(card.validFrom, card.lang)}</dd>
          <dt>{t.until}</dt><dd>{when(card.validUntil, card.lang)}</dd>
          {card.zones.length > 0 && <><dt>{t.access}</dt><dd>{card.zones.map((z) => z.name).join(" · ")}</dd></>}
        </dl>
        {qr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <figure className="keyQr"><img src={qr} alt="" /><figcaption>{card.serial}</figcaption></figure>
        ) : <p className="keyState">{state === "revoked" ? t.revoked : t.expired}</p>}
        {state === "scheduled" && <p className="keyState soon">{t.scheduled.replace("{from}", when(card.validFrom, card.lang))}</p>}
      </article>
      {live && (
        <div className="keyWallets">
          {apple && <a className="keyApple" href={`/api/public/card/${token}/apple`}><span aria-hidden></span>{t.apple}</a>}
          {google && <a className="keyGoogle" href={`/api/public/card/${token}/google`}>{t.google}</a>}
          {!apple && !google && <p className="keyHint">{t.walletLater}</p>}
          <p className="keyHint">{t.hint}</p>
        </div>
      )}
    </main>
  );
}
