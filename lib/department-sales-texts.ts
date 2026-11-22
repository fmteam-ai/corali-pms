// v184 staff copy (Greek / English) for department sales, POS connection, targeted offers and the sales advisor.
import type { PmsLang } from "@/lib/pms-i18n";

const el = {
  "tabs.orders": "Παραγγελίες", "tabs.catalog": "Κατάλογος", "tabs.messages": "Μηνύματα & προσφορές", "tabs.sales": "Πωλήσεις", "tabs.advisor": "Βοηθός πωλήσεων",
  "sales.title": "Πωλήσεις τμημάτων", "sales.subtitle": "Μπαρ, εστιατόριο, spa, γυμναστήριο, ξαπλώστρες: ό,τι πουλήθηκε από την εφαρμογή των πελατών και από το POS κάθε τμήματος.",
  "sales.period": "Περίοδος", "sales.from": "Από", "sales.to": "Έως", "sales.days7": "7 μέρες", "sales.days30": "30 μέρες", "sales.days90": "90 μέρες", "sales.month": "Αυτός ο μήνας", "sales.show": "Εμφάνιση", "sales.csv": "Λήψη CSV",
  "sales.total": "Σύνολο εσόδων", "sales.receipts": "Πωλήσεις", "sales.avg": "Μέση απόδειξη", "sales.perDay": "Ανά ημέρα", "sales.vsPrev": "έναντι προηγούμενης περιόδου", "sales.noPrev": "χωρίς στοιχεία προηγούμενης περιόδου",
  "sales.department": "Τμήμα", "sales.revenue": "Έσοδα", "sales.share": "Μερίδιο", "sales.guests": "Πελάτες ξενοδοχείου", "sales.penetration": "των κρατήσεων", "sales.change": "Μεταβολή",
  "sales.pay.cash": "Μετρητά", "sales.pay.card": "Κάρτα", "sales.pay.room": "Χρέωση δωματίου", "sales.pay.other": "Άλλο", "sales.src.app": "Εφαρμογή", "sales.src.pos": "POS", "sales.src.csv": "Αρχείο CSV",
  "sales.topItems": "Τα πιο δημοφιλή", "sales.byHour": "Πωλήσεις ανά ώρα", "sales.daily": "Ανά ημέρα", "sales.qty": "Τεμ.", "sales.none": "Δεν υπάρχουν πωλήσεις σε αυτή την περίοδο.",
  "sales.recent": "Τελευταίες αποδείξεις POS", "sales.receipt": "Απόδειξη", "sales.when": "Πότε", "sales.payment": "Πληρωμή", "sales.booking": "Κράτηση", "sales.void": "ακυρώθηκε",
  "pos.title": "Σύνδεση POS ανά τμήμα", "pos.help": "Κάθε τμήμα έχει δικό του κλειδί. Το POS στέλνει κάθε απόδειξη στο PMS (μετρητά, κάρτα ή «χρέωση στο δωμάτιο», που μπαίνει αμέσως στον λογαριασμό του πελάτη). Δώστε το κλειδί και τον οδηγό στον τεχνικό του POS.",
  "pos.connected": "Συνδεδεμένο", "pos.notConnected": "Χωρίς POS", "pos.lastSale": "Τελευταία πώληση", "pos.lastSeen": "Τελευταία επικοινωνία", "pos.today": "σήμερα", "pos.never": "ποτέ",
  "pos.create": "Δημιουργία κλειδιού", "pos.renew": "Νέο κλειδί", "pos.revoke": "Αποσύνδεση", "pos.revokeConfirm": "Το POS αυτού του τμήματος θα σταματήσει να στέλνει πωλήσεις. Συνέχεια;", "pos.name": "Όνομα POS (π.χ. «SoftOne μπαρ»)",
  "pos.keyOnce": "Αντιγράψτε το κλειδί τώρα — δεν θα ξαναεμφανιστεί:", "pos.copy": "Αντιγραφή", "pos.copied": "Αντιγράφηκε", "pos.guide": "Οδηγός για τον τεχνικό του POS", "pos.renewConfirm": "Το παλιό κλειδί θα σταματήσει να λειτουργεί. Συνέχεια;",
  "csv.title": "Εισαγωγή πωλήσεων από αρχείο (CSV)", "csv.help": "Για POS χωρίς σύνδεση: εξαγωγή πωλήσεων σε CSV με στήλες ημερομηνία, ώρα, απόδειξη, είδος, ποσότητα, τιμή, πληρωμή, δωμάτιο. Οι αποδείξεις που υπάρχουν ήδη δεν διπλασιάζονται. Οι χρεώσεις δωματίου του αρχείου ΔΕΝ ξαναχρεώνονται στον λογαριασμό του πελάτη.",
  "csv.file": "Αρχείο", "csv.import": "Εισαγωγή", "csv.done": "Προστέθηκαν {added} αποδείξεις ({total}), {dup} υπήρχαν ήδη.", "csv.errors": "Γραμμές που δεν διαβάστηκαν:",
  "aud.title": "Σε ποιους πελάτες", "aud.all": "Όλοι οι πελάτες του ξενοδοχείου", "aud.not_used": "Όσοι δεν έχουν χρησιμοποιήσει ακόμη το τμήμα", "aud.used": "Όσοι έχουν ήδη χρησιμοποιήσει το τμήμα", "aud.families": "Οικογένειες με παιδιά", "aud.couples": "Ζευγάρια (2 ενήλικες)",
  "aud.arriving_today": "Όσοι φτάνουν σήμερα", "aud.departing_tomorrow": "Όσοι φεύγουν αύριο", "aud.long_stay": "Διαμονές 5+ βραδιών", "aud.count": "Θα το δουν {n} κρατήσεις", "aud.countAll": "Όλες οι κρατήσεις που μένουν τώρα ({n})", "aud.languages": "Μόνο σε γλώσσα",
  "aud.noAudience": "Κανένας πελάτης δεν ταιριάζει σε αυτή την ομάδα αυτή τη στιγμή.",
  "offer.item": "Προϊόν / υπηρεσία σε προσφορά", "offer.noItem": "— χωρίς προϊόν (μόνο μήνυμα) —", "offer.discount": "Έκπτωση %", "offer.price": "Τιμή προσφοράς", "offer.help": "Ο πελάτης βλέπει την τιμή προσφοράς στην εφαρμογή και παραγγέλνει με ένα πάτημα· χρεώνεται η τιμή προσφοράς.",
  "offer.results": "{n} παραγγελίες · {amount}", "offer.target": "{n} επιλεγμένες κρατήσεις",
  "adv.title": "Βοηθός πωλήσεων", "adv.subtitle": "Παρακολουθεί κάθε μέρα όλα τα τμήματα (πωλήσεις, ώρες, πελάτες που μένουν, προσφορές) και προτείνει προσφορές και τρόπους να αυξηθούν οι πωλήσεις. Τίποτα δεν στέλνεται μόνο του: εσείς εγκρίνετε.",
  "adv.run": "Ανάλυση τώρα", "adv.runAi": "Ανάλυση τώρα με AI (Claude)", "adv.running": "Ανάλυση…", "adv.lastRun": "Τελευταία ανάλυση", "adv.daily": "Αυτόματα κάθε μέρα στις 09:20.", "adv.noKey": "Χωρίς κλειδί Anthropic οι προτάσεις βγαίνουν μόνο από κανόνες. Για προτάσεις AI: Συνδέσεις → Anthropic (Claude).",
  "adv.open": "Ανοιχτές προτάσεις", "adv.history": "Τελευταίες 14 μέρες", "adv.empty": "Δεν υπάρχουν ανοιχτές προτάσεις. Πατήστε «Ανάλυση τώρα».", "adv.ai": "AI", "adv.rule": "Κανόνας",
  "adv.kind.offer": "Προσφορά", "adv.kind.happy_hour": "Happy hour", "adv.kind.bundle": "Πακέτο", "adv.kind.price": "Τιμή", "adv.kind.timing": "Χρονισμός", "adv.kind.menu": "Κατάλογος", "adv.kind.alert": "Προειδοποίηση",
  "adv.conf.low": "χαμηλή βεβαιότητα", "adv.conf.medium": "μέτρια βεβαιότητα", "adv.conf.high": "υψηλή βεβαιότητα", "adv.audience": "Αποδέκτες", "adv.duration": "Διάρκεια (ώρες)", "adv.startsAt": "Ξεκινά στις",
  "adv.prepare": "Ετοιμασία προσφοράς", "adv.send": "Αποστολή στους πελάτες", "adv.dismiss": "Απόρριψη", "adv.done": "Εντάξει", "adv.applied": "Στάλθηκε", "adv.dismissed": "Απορρίφθηκε", "adv.expired": "Έληξε", "adv.sent": "Η προσφορά στάλθηκε στους πελάτες.",
  "adv.aiError": "Το AI δεν απάντησε ({error}). Οι προτάσεις από κανόνες αποθηκεύτηκαν κανονικά.", "adv.added": "{n} νέες προτάσεις.", "adv.nothing": "Τίποτα νέο αυτή τη στιγμή.",
  "fwd.button": "↪ Προώθηση σε τμήμα", "fwd.to": "Τμήμα", "fwd.note": "Σημείωση για το τμήμα (προαιρετικά)", "fwd.notify": "Ενημέρωση του πελάτη ότι το αίτημα παραλήφθηκε και προωθήθηκε", "fwd.send": "Προώθηση", "fwd.cancel": "Άκυρο",
  "fwd.noRecipients": "χωρίς παραλήπτες", "fwd.setup": "Ορίστε ομάδα προσωπικού ή email στο Τμήματα → Κατάλογος → Επεξεργασία.", "fwd.done": "Προωθήθηκε στο τμήμα «{dept}».", "fwd.doneGuest": "Προωθήθηκε στο τμήμα «{dept}» και ο πελάτης ενημερώθηκε.",
  "fwd.st.sent": "στάλθηκε", "fwd.st.seen": "το είδαν", "fwd.st.done": "ολοκληρώθηκε", "fwd.auto": "αυτόματα",
  "fwd.routing": "Παραλήπτες αιτημάτων πελατών", "fwd.team": "Ομάδα προσωπικού (Corali Staff)", "fwd.noTeam": "— καμία —", "fwd.email": "Email τμήματος", "fwd.autoForward": "Οι παραγγελίες από την εφαρμογή πηγαίνουν αυτόματα στο τμήμα (και ο πελάτης ενημερώνεται)",
  "fwd.routingHelp": "Τα μέλη της ομάδας λαμβάνουν ειδοποίηση στο κινητό (Corali Staff → Τμήμα) και σημειώνουν «Το είδα» / «Ολοκληρώθηκε». Ομάδες: Προσωπικό → Ειδικότητες.",
  "err.ALREADY_FORWARDED": "Έχει ήδη προωθηθεί σε αυτό το τμήμα.", "err.NO_RECIPIENTS": "Το τμήμα δεν έχει παραλήπτες. Ορίστε ομάδα προσωπικού ή email στο Τμήματα → Κατάλογος.",
  "err.failed": "Δεν αποθηκεύτηκε. Δοκιμάστε ξανά.", "err.NOT_FOUND": "Δεν βρέθηκε.", "err.ALREADY_HANDLED": "Το έχει ήδη χειριστεί κάποιος άλλος.", "err.NO_AUDIENCE": "Κανένας πελάτης δεν ταιριάζει σε αυτή την ομάδα αυτή τη στιγμή.", "err.FORBIDDEN": "Δεν έχετε δικαίωμα για αυτή την ενέργεια.",
};

const en: Record<keyof typeof el, string> = {
  "tabs.orders": "Orders", "tabs.catalog": "Catalogue", "tabs.messages": "Messages & offers", "tabs.sales": "Sales", "tabs.advisor": "Sales advisor",
  "sales.title": "Department sales", "sales.subtitle": "Bar, restaurant, spa, gym, beach loungers: what was sold from the guest app and from each department's POS.",
  "sales.period": "Period", "sales.from": "From", "sales.to": "To", "sales.days7": "7 days", "sales.days30": "30 days", "sales.days90": "90 days", "sales.month": "This month", "sales.show": "Show", "sales.csv": "Download CSV",
  "sales.total": "Total revenue", "sales.receipts": "Sales", "sales.avg": "Average ticket", "sales.perDay": "Per day", "sales.vsPrev": "vs previous period", "sales.noPrev": "no data for the previous period",
  "sales.department": "Department", "sales.revenue": "Revenue", "sales.share": "Share", "sales.guests": "Hotel guests", "sales.penetration": "of bookings", "sales.change": "Change",
  "sales.pay.cash": "Cash", "sales.pay.card": "Card", "sales.pay.room": "Charged to room", "sales.pay.other": "Other", "sales.src.app": "App", "sales.src.pos": "POS", "sales.src.csv": "CSV file",
  "sales.topItems": "Best sellers", "sales.byHour": "Sales by hour", "sales.daily": "Per day", "sales.qty": "Qty", "sales.none": "No sales in this period.",
  "sales.recent": "Latest POS receipts", "sales.receipt": "Receipt", "sales.when": "When", "sales.payment": "Payment", "sales.booking": "Booking", "sales.void": "voided",
  "pos.title": "POS connection per department", "pos.help": "Each department has its own key. The POS sends every receipt to the PMS (cash, card or «charge to room», which goes straight to the guest's account). Give the key and the guide to the POS technician.",
  "pos.connected": "Connected", "pos.notConnected": "No POS", "pos.lastSale": "Last sale", "pos.lastSeen": "Last contact", "pos.today": "today", "pos.never": "never",
  "pos.create": "Create key", "pos.renew": "New key", "pos.revoke": "Disconnect", "pos.revokeConfirm": "This department's POS will stop sending sales. Continue?", "pos.name": "POS name (e.g. «SoftOne bar»)",
  "pos.keyOnce": "Copy the key now — it will not be shown again:", "pos.copy": "Copy", "pos.copied": "Copied", "pos.guide": "Guide for the POS technician", "pos.renewConfirm": "The old key will stop working. Continue?",
  "csv.title": "Import sales from a file (CSV)", "csv.help": "For a POS without a connection: export sales to CSV with the columns date, time, receipt, item, quantity, price, payment, room. Receipts already imported are not doubled. Room charges in the file are NOT charged to the guest's account again.",
  "csv.file": "File", "csv.import": "Import", "csv.done": "{added} receipts added ({total}), {dup} were already there.", "csv.errors": "Lines that could not be read:",
  "aud.title": "Which guests", "aud.all": "All guests in the hotel", "aud.not_used": "Guests who have not used the department yet", "aud.used": "Guests who already used the department", "aud.families": "Families with children", "aud.couples": "Couples (2 adults)",
  "aud.arriving_today": "Arriving today", "aud.departing_tomorrow": "Departing tomorrow", "aud.long_stay": "Stays of 5+ nights", "aud.count": "{n} bookings will see it", "aud.countAll": "Every booking in house now ({n})", "aud.languages": "Only in language",
  "aud.noAudience": "No guest matches this group right now.",
  "offer.item": "Product / service on offer", "offer.noItem": "— no product (message only) —", "offer.discount": "Discount %", "offer.price": "Offer price", "offer.help": "The guest sees the offer price in the app and orders with one tap; the offer price is charged.",
  "offer.results": "{n} orders · {amount}", "offer.target": "{n} bookings chosen",
  "adv.title": "Sales advisor", "adv.subtitle": "Watches every department each day (sales, hours, guests in house, offers) and proposes offers and ways to raise sales. Nothing is sent on its own: you approve.",
  "adv.run": "Analyse now", "adv.runAi": "Analyse now with AI (Claude)", "adv.running": "Analysing…", "adv.lastRun": "Last analysis", "adv.daily": "Automatically every day at 09:20.", "adv.noKey": "Without an Anthropic key the suggestions come from rules only. For AI suggestions: Integrations → Anthropic (Claude).",
  "adv.open": "Open suggestions", "adv.history": "Last 14 days", "adv.empty": "No open suggestions. Press «Analyse now».", "adv.ai": "AI", "adv.rule": "Rule",
  "adv.kind.offer": "Offer", "adv.kind.happy_hour": "Happy hour", "adv.kind.bundle": "Bundle", "adv.kind.price": "Price", "adv.kind.timing": "Timing", "adv.kind.menu": "Catalogue", "adv.kind.alert": "Alert",
  "adv.conf.low": "low confidence", "adv.conf.medium": "medium confidence", "adv.conf.high": "high confidence", "adv.audience": "Recipients", "adv.duration": "Duration (hours)", "adv.startsAt": "Starts at",
  "adv.prepare": "Prepare offer", "adv.send": "Send to guests", "adv.dismiss": "Dismiss", "adv.done": "OK", "adv.applied": "Sent", "adv.dismissed": "Dismissed", "adv.expired": "Expired", "adv.sent": "The offer was sent to the guests.",
  "adv.aiError": "The AI did not answer ({error}). The rule suggestions were saved as usual.", "adv.added": "{n} new suggestions.", "adv.nothing": "Nothing new right now.",
  "fwd.button": "↪ Forward to department", "fwd.to": "Department", "fwd.note": "Note for the department (optional)", "fwd.notify": "Tell the guest the request was received and forwarded", "fwd.send": "Forward", "fwd.cancel": "Cancel",
  "fwd.noRecipients": "no recipients", "fwd.setup": "Set a staff team or e-mail in Departments → Catalogue → Edit.", "fwd.done": "Forwarded to «{dept}».", "fwd.doneGuest": "Forwarded to «{dept}»; the guest was told.",
  "fwd.st.sent": "sent", "fwd.st.seen": "seen", "fwd.st.done": "done", "fwd.auto": "automatic",
  "fwd.routing": "Recipients of guest requests", "fwd.team": "Staff team (Corali Staff)", "fwd.noTeam": "— none —", "fwd.email": "Department e-mail", "fwd.autoForward": "Orders from the app go to the department automatically (and the guest is told)",
  "fwd.routingHelp": "Team members get a phone alert (Corali Staff → Department) and mark «Seen» / «Done». Teams: Staff → Specialties.",
  "err.ALREADY_FORWARDED": "Already forwarded to this department.", "err.NO_RECIPIENTS": "The department has no recipients. Set a staff team or e-mail in Departments → Catalogue.",
  "err.failed": "Not saved. Please try again.", "err.NOT_FOUND": "Not found.", "err.ALREADY_HANDLED": "Someone else already handled it.", "err.NO_AUDIENCE": "No guest matches this group right now.", "err.FORBIDDEN": "You don't have permission for this.",
};

export type SalesKey = keyof typeof el;
export function salesT(lang: PmsLang) {
  const d = lang === "en" ? en : el;
  return (key: SalesKey, vars?: Record<string, string | number>) => {
    let s = d[key] ?? el[key] ?? key;
    for (const [k, v] of Object.entries(vars ?? {})) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}
/** An error code from the API in the staff's language. */
export function salesError(lang: PmsLang, code: unknown): string {
  const t = salesT(lang), k = `err.${String(code)}` as SalesKey;
  return k in el ? t(k) : t("err.failed");
}
