// PMS → App store: every integration and add-on module in one catalogue, with its state for this hotel and the page
// where it is set up. Partner systems (POS, accounting, BI, automation) connect through the open API.
import { db } from "@/lib/db";

export type AppCategory = "distribution" | "payments" | "messaging" | "accounting" | "revenue" | "guest" | "devices" | "ai" | "partners";
export type AppEntry = { key: string; icon: string; name: string; category: AppCategory; el: string; en: string; href: string; state: "on" | "off" | "partial" };

type Def = Omit<AppEntry, "state"> & { check: (s: Signals) => AppEntry["state"] };
type Signals = { providers: Map<string, boolean>; json: Map<string, Record<string, unknown>>; counts: Record<string, number> };
const provider = (k: string) => (s: Signals) => (s.providers.get(k) ? "on" : "off") as AppEntry["state"];
const count = (k: string) => (s: Signals) => ((s.counts[k] ?? 0) > 0 ? "on" : "off") as AppEntry["state"];

const CATALOG: Def[] = [
  { key: "channex", icon: "🌐", name: "Channex Channel Manager", category: "distribution", el: "Booking.com, Expedia, Airbnb κ.ά.: διαθεσιμότητα, τιμές και περιορισμοί προς τα OTA, άμεση εισαγωγή κρατήσεων με webhook.", en: "Booking.com, Expedia, Airbnb and more: availability, rates and restrictions to the OTAs, instant booking import by webhook.", href: "/pms/integrations", check: provider("channelManager") },
  { key: "widgets", icon: "🧩", name: "Booking widgets", category: "distribution", el: "Μηχανή κρατήσεων και widget τιμών για την ιστοσελίδα του ξενοδοχείου.", en: "Booking engine and rate widget for the hotel website.", href: "/pms/widgets", check: count("widgets") },
  { key: "stripe", icon: "💳", name: "Stripe", category: "payments", el: "Online πληρωμές καρτών, προκαταβολές, αυτόματη είσπραξη υπολοίπου.", en: "Online card payments, deposits, automatic balance collection.", href: "/pms/integrations", check: provider("stripe") },
  { key: "viva", icon: "💶", name: "Viva.com", category: "payments", el: "Πληρωμές μέσω Viva Smart Checkout.", en: "Payments with Viva Smart Checkout.", href: "/pms/integrations", check: provider("viva") },
  { key: "mydata", icon: "🧾", name: "ΑΑΔΕ myDATA", category: "accounting", el: "Αποδείξεις και τιμολόγια με διαβίβαση στο myDATA και ουρά επαναπροσπάθειας.", en: "Receipts and invoices sent to myDATA with a retry queue.", href: "/pms/integrations", check: provider("mydata") },
  { key: "smtp", icon: "✉️", name: "Email (SMTP)", category: "messaging", el: "Επιβεβαιώσεις, υπενθυμίσεις, ψηφιακά κλειδιά και μηνύματα πελατών.", en: "Confirmations, reminders, digital keys and guest messages.", href: "/pms/integrations", check: provider("smtp") },
  { key: "whatsapp", icon: "💬", name: "WhatsApp Business", category: "messaging", el: "Αυτόματα μηνύματα και συνομιλίες με πελάτες στο WhatsApp.", en: "Automatic messages and guest chats on WhatsApp.", href: "/pms/integrations", check: provider("whatsapp") },
  { key: "automations", icon: "⏰", name: "Message automations", category: "messaging", el: "Μηνύματα πριν την άφιξη, check-in, υπόλοιπο, αξιολόγηση, γενέθλια.", en: "Pre-arrival, check-in, balance, review and birthday messages.", href: "/pms/automations", check: count("automations") },
  { key: "meta", icon: "📣", name: "Facebook / Instagram", category: "messaging", el: "Δημοσιεύσεις με έγκριση και μηνύματα (DM) που γίνονται κρατήσεις.", en: "Approved posts and DMs that become bookings.", href: "/pms/social", check: provider("meta") },
  { key: "tiktok", icon: "🎵", name: "TikTok", category: "messaging", el: "Δημοσίευση βίντεο από το PMS με έγκριση.", en: "Video posts from the PMS with approval.", href: "/pms/social", check: provider("tiktok") },
  { key: "autopricing", icon: "📈", name: "Automatic pricing", category: "revenue", el: "Τιμές που ακολουθούν τη ζήτηση, μέσα στα όρια ελάχιστης / μέγιστης τιμής σας.", en: "Prices that follow demand, inside your minimum / maximum.", href: "/pms/pricing/auto", check: (s) => (s.json.get("autopricing")?.enabled ? (s.json.get("autopricing")?.mode === "auto" ? "on" : "partial") : "off") },
  { key: "rateshopper", icon: "🔎", name: "Rate shopper", category: "revenue", el: "Τιμές ανταγωνιστών ανά ημερομηνία για σύγκριση και αυτόματη τιμολόγηση.", en: "Competitor rates per date for comparison and automatic pricing.", href: "/pms/reports/revenue", check: count("competitors") },
  { key: "portal", icon: "📱", name: "Guest app / portal", category: "guest", el: "Υπηρεσίες, παραγγελίες, ραντεβού και ανακοινώσεις στο κινητό του πελάτη.", en: "Services, orders, appointments and announcements on the guest's phone.", href: "/pms/departments", check: count("departments") },
  { key: "accesscards", icon: "🔑", name: "Digital keys (Wallet)", category: "guest", el: "Ψηφιακό κλειδί δωματίου σε Apple / Google Wallet, αυτόματα την προηγούμενη της άφιξης.", en: "Room key in Apple / Google Wallet, sent automatically the day before arrival.", href: "/pms/access-cards", check: (s) => (s.json.get("accesscards")?.enabled ? "on" : "off") },
  { key: "tv", icon: "📺", name: "Corali TV", category: "devices", el: "Οθόνη καλωσορίσματος, κανάλια, μηνύματα και αιτήματα από την τηλεόραση.", en: "Welcome screen, channels, messages and requests on the room TV.", href: "/pms/tv", check: count("tvScreens") },
  { key: "shelly", icon: "🔌", name: "Shelly smart plugs", category: "devices", el: "Ενεργοποίηση / απενεργοποίηση τηλεοράσεων με έξυπνη πρίζα.", en: "Switch TVs on and off with a smart plug.", href: "/pms/tv", check: count("shelly") },
  { key: "roomac", icon: "❄️", name: "A/C control (Shelly + Tuya)", category: "devices", el: "Το κλιματιστικό έχει ρεύμα μόνο με πελάτη στο δωμάτιο (check-in και, με αισθητήρα παρουσίας, όταν είναι μέσα).", en: "The A/C has power only with a guest in the room (checked in and, with a presence sensor, actually inside).", href: "/pms/room-ac", check: count("roomAc") },
  { key: "staff", icon: "🧹", name: "Corali Staff app", category: "devices", el: "Εφαρμογή προσωπικού: καθαριότητα, βλάβες, βάρδιες, ειδοποιήσεις.", en: "Staff app: housekeeping, defects, shifts, notifications.", href: "/pms/staff", check: count("staffPush") },
  { key: "claude", icon: "🤖", name: "AI assistant (Claude)", category: "ai", el: "Βοηθός PMS που προτείνει και εκτελεί ενέργειες με έγκριση, AI τιμολόγηση και μηνύματα.", en: "PMS assistant that proposes actions for approval, AI pricing and messages.", href: "/pms/integrations", check: provider("anthropic") },
  { key: "api", icon: "🛠️", name: "Open API & webhooks", category: "partners", el: "Κλειδιά API με δικαιώματα και webhooks για δικά σας συστήματα.", en: "Scoped API keys and webhooks for your own systems.", href: "/pms/api", check: (s) => ((s.counts.apiKeys ?? 0) + (s.counts.webhooks ?? 0) > 0 ? "on" : "off") },
  { key: "pos", icon: "🍽️", name: "POS εστιατορίου / μπαρ", category: "partners", el: "Χρεώσεις στο δωμάτιο από το ταμείο (POST /api/v1/bookings/{δωμάτιο}/charges).", en: "Room charges from the till (POST /api/v1/bookings/{room}/charges).", href: "/pms/api", check: count("posKeys") },
  { key: "accounting", icon: "📚", name: "Λογιστικό πρόγραμμα", category: "partners", el: "Κινήσεις και παραστατικά για το λογιστήριο (Epsilon, SoftOne, Entersoft κ.ά.) μέσω API.", en: "Transactions and documents for accounting software (Epsilon, SoftOne, Entersoft…) through the API.", href: "/pms/api", check: count("accountingKeys") },
  { key: "automation", icon: "⚡", name: "Zapier / Make / n8n", category: "partners", el: "Αυτοματισμοί χωρίς κώδικα με webhooks: νέα κράτηση → Google Sheets, Slack, CRM.", en: "No-code automations with webhooks: new booking → Google Sheets, Slack, CRM.", href: "/pms/api", check: count("webhooks") },
];

type Rows = { rows: Record<string, unknown>[] };
async function safe(q: Promise<Rows>, fallback: Rows): Promise<Rows> { try { return await q; } catch { return fallback; } }
const one = (r: { rows: Record<string, unknown>[] }) => Number(r.rows[0]?.n ?? 0);
const empty: Rows = { rows: [] };

export async function appStore(ownerId: string): Promise<AppEntry[]> {
  const q = (sql: string) => safe(db().query(sql, [ownerId]), empty);
  const [providers, auto, cards, widgets, autom, comp, depts, tvs, shelly, push, keys, hooks, roomAc] = await Promise.all([
    q(`SELECT provider_key,active FROM provider_connections WHERE owner_id=$1`),
    q(`SELECT settings_json FROM auto_pricing_settings WHERE owner_id=$1`),
    q(`SELECT settings_json FROM access_card_settings WHERE owner_id=$1`),
    q(`SELECT count(*) n FROM rate_widget_settings WHERE owner_id=$1 AND active=1`),
    q(`SELECT count(*) n FROM message_automation_settings WHERE owner_id=$1 AND enabled=1`),
    q(`SELECT count(*) n FROM competitors WHERE owner_id=$1 AND active=1`),
    q(`SELECT count(*) n FROM hotel_departments WHERE owner_id=$1`),
    q(`SELECT count(*) n FROM tv_screens WHERE owner_id=$1`),
    q(`SELECT count(*) n FROM tv_screens WHERE owner_id=$1 AND power_device_id<>''`),
    q(`SELECT count(*) n FROM push_subscriptions WHERE owner_id=$1`),
    q(`SELECT scopes_json FROM api_keys WHERE owner_id=$1 AND revoked_at IS NULL`),
    q(`SELECT count(*) n FROM api_webhooks WHERE owner_id=$1 AND active=1`),
    q(`SELECT count(*) n FROM room_ac_devices WHERE owner_id=$1`),
  ]);
  const parse = (r: { rows: Record<string, unknown>[] }) => { try { return JSON.parse(String(r.rows[0]?.settings_json ?? "{}")) as Record<string, unknown>; } catch { return {}; } };
  const scopes = keys.rows.map((k) => { try { return JSON.parse(String(k.scopes_json)) as string[]; } catch { return []; } });
  const s: Signals = {
    providers: new Map(providers.rows.map((p) => [String(p.provider_key), Number(p.active) === 1])),
    json: new Map([["autopricing", parse(auto)], ["accesscards", parse(cards)]]),
    counts: { widgets: one(widgets), automations: one(autom), competitors: one(comp), departments: one(depts), tvScreens: one(tvs), shelly: one(shelly), staffPush: one(push), apiKeys: keys.rows.length, webhooks: one(hooks), roomAc: one(roomAc), posKeys: scopes.filter((x) => x.includes("folio.write")).length, accountingKeys: scopes.filter((x) => x.includes("accounting.read")).length },
  };
  return CATALOG.map(({ check, ...a }) => ({ ...a, state: check(s) }));
}
