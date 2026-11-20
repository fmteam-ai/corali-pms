// Corali TV data: per-room screen links, settings, the current guest of a room and the Paros weather.
import { createHash } from "node:crypto";
import QRCode from "qrcode";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { translatedText } from "@/lib/public-rate";
import { newOpaqueToken } from "@/lib/security/tokens";
import { hotelToday } from "@/lib/tape-chart";
import { fillInfo } from "@/lib/tv-info";
import { screenMessages } from "@/lib/tv-messages";
import { guestTvRequests, screenDnd } from "@/lib/tv-requests";
import { instayAsk } from "@/lib/instay";
import { guestWifiFor } from "@/lib/guest-wifi";
import { beachesToday, beachTodayTexts, windNames } from "@/lib/tv-beaches";
import { instayTexts, instayTopics } from "@/lib/instay-core";
import { defaultTransferTime, transferDays, tvProblemTexts, tvRequestTexts, tvTransferTexts } from "@/lib/tv-requests-core";
import { channelSource, tvChannelTexts } from "@/lib/tv-channels-core";
import { tvAppTexts } from "@/lib/tv-apps-core";
import { speechLocale, tvAssistantTexts } from "@/lib/tv-assistant-core";
import { questionsFor } from "@/lib/tv-questions";
import { beaufort, currentStay, whatsappLink, firstName, normalizeTvSettings, pickText, tvLanguage, tvTexts, weatherIcon, wifiQrPayload, type TvLanguage, type TvSettings, type TvStay } from "@/lib/tv-core";

export async function loadTvSettings(ownerId: string): Promise<TvSettings> {
  const r = await db().query(`SELECT settings_json FROM tv_settings WHERE owner_id=$1`, [ownerId]);
  let raw: unknown = null;
  try { raw = r.rows[0] ? JSON.parse(String(r.rows[0].settings_json)) : null; } catch { raw = null; }
  return normalizeTvSettings(raw);
}

/** Every active room gets a screen with its own secret link (created on first use). */
export async function ensureScreens(ownerId: string) {
  const missing = await db().query(`SELECT r.id FROM rooms r WHERE r.owner_id=$1 AND r.active=1 AND NOT EXISTS (SELECT 1 FROM tv_screens s WHERE s.owner_id=r.owner_id AND s.room_id=r.id)`, [ownerId]);
  for (const row of missing.rows) {
    await db().query(`INSERT INTO tv_screens(owner_id,room_id,token,created_at) VALUES($1,$2,$3,$4) ON CONFLICT(owner_id,room_id) DO NOTHING`, [ownerId, row.id, newOpaqueToken(), Date.now()]);
  }
}

export type TvScreenRow = { room_id: number; room_code: string; room_type: string; token: string; wifi_ssid: string; wifi_password: string; active: number; last_seen_at: number | null; url: string; power_device_id: string; power_channel: number; power_state: number | null; power_changed_at: number | null; power_error: string ; screen_seen_at: number | null; screen_interactive: number | null; app_version: number | null; app_admin: number | null; power_method: string; volume_percent: number | null; volume_muted: number | null; volume_fixed: number | null; caps: Record<string, string | null>; policy_clamped_at: number | null; policy_rev_applied: number | null; menu_lock_state: string | null; menu_lock_seen_at: number | null; fridge_alert_at: number | null };

export async function listScreens(ownerId: string): Promise<TvScreenRow[]> {
  await ensureScreens(ownerId);
  const r = await db().query(`SELECT s.room_id,r.code AS room_code,r.room_type,s.token,s.wifi_ssid,s.wifi_password,s.active,s.last_seen_at,s.power_device_id,s.power_channel,s.power_state,s.power_changed_at,s.power_error,s.screen_seen_at,s.screen_interactive,s.app_version,s.app_admin,s.volume_percent,s.volume_muted,s.volume_fixed,s.caps_json,s.policy_clamped_at,s.policy_rev_applied,s.menu_lock_state,s.menu_lock_seen_at,s.fridge_alert_at,COALESCE(s.power_method, CASE WHEN s.power_device_id<>'' THEN 'shelly' ELSE 'manual' END) AS power_method FROM tv_screens s JOIN rooms r ON r.id=s.room_id AND r.owner_id=s.owner_id WHERE s.owner_id=$1 AND r.active=1 ORDER BY r.code`, [ownerId]);
  return r.rows.map((x) => ({ ...x, room_id: Number(x.room_id), active: Number(x.active), last_seen_at: x.last_seen_at === null ? null : Number(x.last_seen_at), url: tvUrl(String(x.token)), power_channel: Number(x.power_channel), power_state: x.power_state === null ? null : Number(x.power_state), power_changed_at: x.power_changed_at === null ? null : Number(x.power_changed_at), screen_seen_at: x.screen_seen_at === null ? null : Number(x.screen_seen_at), screen_interactive: x.screen_interactive === null ? null : Number(x.screen_interactive), app_version: x.app_version === null ? null : Number(x.app_version), app_admin: x.app_admin === null ? null : Number(x.app_admin), power_method: String(x.power_method), volume_percent: x.volume_percent === null ? null : Number(x.volume_percent), volume_muted: x.volume_muted === null ? null : Number(x.volume_muted), volume_fixed: x.volume_fixed === null ? null : Number(x.volume_fixed), caps: (() => { try { return x.caps_json ? JSON.parse(String(x.caps_json)) : {}; } catch { return {}; } })(), policy_clamped_at: x.policy_clamped_at === null ? null : Number(x.policy_clamped_at), policy_rev_applied: x.policy_rev_applied === null || x.policy_rev_applied === undefined ? null : Number(x.policy_rev_applied), menu_lock_state: x.menu_lock_state ?? null, menu_lock_seen_at: x.menu_lock_seen_at === null || x.menu_lock_seen_at === undefined ? null : Number(x.menu_lock_seen_at), fridge_alert_at: x.fridge_alert_at === null || x.fridge_alert_at === undefined ? null : Number(x.fridge_alert_at) })) as TvScreenRow[];
}

/** TV app setup codes (PMS → Corali TV → "App code"): 6 digits, one use, valid 30 minutes; only the hash is stored. */
export const SETUP_CODE_MS = 30 * 60_000;
export const setupCodeHash = (code: string) => createHash("sha256").update(`corali-tv-setup:${code}`).digest("hex");

/** Exchange a setup code for the room's screen link (and use the code up). Null when unknown, expired or inactive. */
export async function redeemSetupCode(code: string): Promise<{ url: string; roomCode: string } | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const r = await db().query(
    `UPDATE tv_screens s SET setup_code_hash=NULL,setup_expires_at=NULL FROM rooms r
     WHERE s.setup_code_hash=$1 AND s.setup_expires_at>$2 AND s.active=1 AND r.id=s.room_id AND r.owner_id=s.owner_id AND r.active=1
     RETURNING s.token,r.code AS room_code`,
    [setupCodeHash(code), Date.now()],
  );
  const row = r.rows[0];
  return row ? { url: tvUrl(String(row.token)), roomCode: String(row.room_code) } : null;
}

export const tvUrl = (token: string) => `${env().BOOKING_ORIGIN}/tv/${token}`;

export const hotelTime = (now = new Date()) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);

// Weather for Piso Livadi from Open-Meteo (free, no key), cached for 30 minutes; null when unreachable.
let weatherCache: { at: number; value: TvWeather | null } | null = null;
export type TvWeather = { temp: number; code: number; icon: string; wind: number; windDir: number | null; wave: number | null; days: { date: string; code: number; icon: string; max: number; min: number }[] };
/** v176: wave height (m) off Piso Livadi from Open-Meteo Marine (free, no key); null when unreachable. */
async function waveHeight(): Promise<number | null> {
  try {
    const r = await fetch("https://marine-api.open-meteo.com/v1/marine?latitude=37.0405&longitude=25.2650&current=wave_height&timezone=Europe%2FAthens", { signal: AbortSignal.timeout(5000) });
    const h = r.ok ? Number((await r.json())?.current?.wave_height) : NaN;
    return Number.isFinite(h) ? Math.round(h * 10) / 10 : null;
  } catch { return null; }
}
async function weather(): Promise<TvWeather | null> {
  if (weatherCache && Date.now() - weatherCache.at < 30 * 60_000) return weatherCache.value;
  let value: TvWeather | null = null;
  try {
    const r = await fetch("https://api.open-meteo.com/v1/forecast?latitude=37.0405&longitude=25.2555&current=temperature_2m,weather_code,wind_speed_10m,wind_direction_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=Europe%2FAthens&forecast_days=5", { signal: AbortSignal.timeout(5000) });
    if (r.ok) {
      const d = await r.json();
      value = {
        temp: Math.round(Number(d.current.temperature_2m)), code: Number(d.current.weather_code), icon: weatherIcon(Number(d.current.weather_code)), wind: beaufort(Number(d.current.wind_speed_10m)),
        windDir: Number.isFinite(Number(d.current.wind_direction_10m)) ? Number(d.current.wind_direction_10m) : null, wave: await waveHeight(),
        days: (d.daily.time as string[]).map((date, i) => ({ date, code: Number(d.daily.weather_code[i]), icon: weatherIcon(Number(d.daily.weather_code[i])), max: Math.round(Number(d.daily.temperature_2m_max[i])), min: Math.round(Number(d.daily.temperature_2m_min[i])) })),
      };
    }
  } catch { value = null; }
  weatherCache = { at: Date.now(), value };
  return value;
}

const qr = (text: string) => QRCode.toDataURL(text, { errorCorrectionLevel: "M", margin: 1, width: 360, color: { dark: "#173e47", light: "#ffffff" } });

/** Everything a room's screen shows now, or null for an unknown/disabled link. Never more than the first name. */
export async function tvScreenData(token: string, langOverride?: string | null) {
  if (!/^[A-Za-z0-9_-]{20,80}$/.test(token)) return null;
  const s = (await db().query(`SELECT s.id,s.owner_id,s.room_id,s.wifi_ssid,s.wifi_password,s.last_seen_at,r.code AS room_code FROM tv_screens s JOIN rooms r ON r.id=s.room_id AND r.owner_id=s.owner_id WHERE s.token=$1 AND s.active=1 AND r.active=1`, [token])).rows[0];
  if (!s) return null;
  const ownerId = String(s.owner_id), today = hotelToday(), now = Date.now();
  if (!s.last_seen_at || now - Number(s.last_seen_at) > 5 * 60_000) await db().query(`UPDATE tv_screens SET last_seen_at=$1 WHERE id=$2`, [now, s.id]);
  const settings = await loadTvSettings(ownerId);
  const stays = (await db().query(`SELECT reference,guest_name,guest_language,check_in,check_out,status,adults,children FROM bookings WHERE owner_id=$1 AND room_id=$2 AND status IN ('confirmed','checked_in') AND check_in<=$3 AND check_out>=$3 ORDER BY check_in`, [ownerId, s.room_id, today])).rows as TvStay[];
  const state = currentStay(stays, today, hotelTime(), settings.checkOutTime);
  const lang: TvLanguage = langOverride ? tvLanguage(langOverride) : state.mode === "stay" ? tvLanguage(state.stay.guest_language) : "en";
  // v177: during a stay with its own Wi-Fi password (Omada PPSK), that network and password; otherwise the hotel's.
  const stayId = state.mode === "stay" ? (await db().query(`SELECT id FROM bookings WHERE owner_id=$1 AND reference=$2`, [ownerId, state.stay.reference])).rows[0]?.id : null;
  const own = stayId ? await guestWifiFor(ownerId, Number(stayId)) : null;
  const ssid = own ? own.ssid : String(s.wifi_ssid || settings.wifiSsid), password = own ? own.password : String(s.wifi_ssid ? s.wifi_password : settings.wifiPassword);
  const [extras, wx] = await Promise.all([
    settings.showExtras ? db().query(`SELECT name,name_el,name_en,name_translations_json,price_cents,pricing_mode FROM extras WHERE owner_id=$1 AND active=1 ORDER BY sort_order,id LIMIT 6`, [ownerId]) : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
    settings.showWeather ? weather() : Promise.resolve(null),
  ]);
  const manageUrl = `${env().BOOKING_ORIGIN}/manage-booking?lang=${lang}`;
  return {
    lang, texts: tvTexts[lang], roomCode: String(s.room_code), today,
    guest: state.mode === "stay" ? { firstName: firstName(state.stay.guest_name), checkIn: state.stay.check_in, checkOut: state.stay.check_out, departureToday: state.departureToday } : null,
    checkInTime: settings.checkInTime, checkOutTime: settings.checkOutTime, receptionPhone: settings.receptionPhone,
    welcome: pickText(settings.welcome, lang),
    tips: pickText(settings.tips, lang).split("\n").map((t) => t.trim()).filter(Boolean).slice(0, 8),
    wifi: ssid ? { ssid, password, qr: await qr(wifiQrPayload(ssid, password)), note: pickText(settings.wifiNote, lang) } : null,
    extras: extras.rows.map((e) => ({ name: translatedText(e.name_translations_json, lang, e.name_el, e.name_en, e.name), priceCents: Number(e.price_cents), perNight: String(e.pricing_mode).includes("night"), perPerson: e.pricing_mode === "per_person" })),
    weather: wx,
    // v176: «Beaches today»: today's wind and waves and the beaches that suit them (from PMS → Corali TV → Beaches).
    beachToday: wx && settings.beaches.length ? (() => {
      const r = beachesToday(settings.beaches, wx.wind, wx.windDir, settings.beachMode);
      return { texts: beachTodayTexts[lang], windy: r.windy, wind: wx.wind, dir: r.dir ? (lang === "el" ? windNames[r.dir].el : windNames[r.dir].en) : "", wave: wx.wave, beaches: r.beaches.map((b) => ({ name: b.name, minutes: b.minutes })) };
    })() : null,
    manage: { url: manageUrl, qr: await qr(manageUrl) },
    whatsapp: settings.whatsappNumber ? { qr: await qr(whatsappLink(settings.whatsappNumber, tvTexts[lang].waHello.replace("{room}", String(s.room_code)))) } : null,
    guide: settings.travelGuideUrl ? { qr: await qr(settings.travelGuideUrl) } : null,
    // Requests to reception (TV → PMS) only while a guest is staying in the room.
    requests: state.mode === "stay" ? {
      texts: tvRequestTexts[lang], dnd: await screenDnd(ownerId, Number(s.room_id)),
      // The stay's own requests with their state; open ones can be cancelled from the TV.
      mine: await guestTvRequests(ownerId, Number(s.room_id), state.stay.reference),
      // Transfer form: days the guest can choose, a sensible first time and the party size from the booking.
      problems: tvProblemTexts[lang],
      transfer: { texts: tvTransferTexts[lang], days: transferDays(today, state.stay.check_out), first: defaultTransferTime(hotelTime()), people: Math.max(1, Math.min(12, Number(state.stay.adults ?? 1) + Number(state.stay.children ?? 0))) },
    } : null,
    // v176: «Is everything all right?» on the second day of the stay (until answered on the TV or the phone).
    instay: state.mode === "stay" ? await (async () => {
      const id = (await db().query(`SELECT id FROM bookings WHERE owner_id=$1 AND reference=$2`, [ownerId, state.stay.reference])).rows[0]?.id;
      return id && (await instayAsk(ownerId, Number(id), { status: String(state.stay.status), check_in: String(state.stay.check_in), check_out: String(state.stay.check_out) })) ? { texts: instayTexts[lang], topics: instayTopics } : null;
    })() : null,
    // Live channels the hotel added (PMS → Corali TV): only the ones that can play.
    channels: settings.channels.flatMap((c) => { const source = channelSource(c.url); return source ? [{ name: c.name, logo: c.logo, category: c.category, source }] : []; }),
    channelTexts: tvChannelTexts[lang],
    // Streaming apps the Corali TV Android app may open (shown only inside the app, only if installed).
    apps: settings.apps.map((a) => ({ key: a.key, name: a.name, packages: a.packages, color: a.color })),
    appTexts: tvAppTexts[lang],
    // AI assistant tab (PMS → Corali TV): only during a stay; voice works inside the Corali TV app (1.5+).
    assistant: settings.assistant && state.mode === "stay" ? { texts: { ...tvAssistantTexts[lang], suggestions: questionsFor(settings.assistantQuestions, lang) }, speech: speechLocale[lang] } : null,
    messages: await screenMessages(ownerId, Number(s.room_id), lang, token, state.mode === "stay" ? firstName(state.stay.guest_name) : null),
    info: settings.info.map((x) => ({ key: x.key, icon: x.icon, title: pickText(x.title, lang), body: fillInfo(pickText(x.body, lang), { checkIn: settings.checkInTime, checkOut: settings.checkOutTime, wifi: ssid, password }) })).filter((x) => x.title && x.body),
  };
}
export type TvScreenData = NonNullable<Awaited<ReturnType<typeof tvScreenData>>>;
