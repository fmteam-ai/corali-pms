"use client";
// PMS → Corali TV → «Ήχος & Hotel Mode» (v159): volume / mute per room through the Corali TV app (≥ 1.9), sound
// policy (power-on volume, maximum volume enforced by the app = software), what each TV reports it can do, and the
// factory Hotel Mode settings as read (never written). Every command shows the TV's own report, not just "sent".
import { useCallback, useEffect, useState } from "react";
import type { TvScreenRow } from "@/lib/tv";
import type { CommandRow } from "@/lib/tv-commands";
import { agentState, FINAL_STATUSES, type SoundPolicy } from "../../../scripts/tv-command-core.mjs";
import { Fold } from "./fold";

type Policy = SoundPolicy & { rev?: number };
type Data = { screens: TvScreenRow[]; policies: Record<number, Policy>; commands: Record<number, CommandRow>; soundApp: number; preset: SoundPolicy; factoryMenuApp?: number; menuLockApp?: number; isOwner?: boolean; canMenuLock?: boolean };
type ResetResult = { roomId: number; roomCode: string; policySaved: boolean; commandIds: number[]; status: string };
const FINAL_RESET = ["EXECUTED", "FAILED", "UNVERIFIED", "APP_TOO_OLD", "SUPERSEDED"];

const EL = {
  title: "Ήχος & Hotel Mode",
  help: "Η ένταση αλλάζει από την εφαρμογή Corali TV (1.9 ή νεότερη) μέσω Wi-Fi. Κάθε εντολή δείχνει «✓» μόνο όταν η τηλεόραση διαβάσει μετά την πραγματική ένταση. Το «μέγιστο» είναι όριο λογισμικού της εφαρμογής: αν ο επισκέπτης το ξεπεράσει με το τηλεχειριστήριο, η εφαρμογή το επαναφέρει σε λίγα δευτερόλεπτα — δεν είναι εργοστασιακό κλείδωμα.",
  room: "Δωμάτιο", state: "Τηλεόραση", volume: "Ένταση", policy: "Πολιτική ήχου", caps: "Δυνατότητες (όπως τις αναφέρει η TV)", last: "Τελευταία εντολή",
  set: "Ορισμός", mute: "🔇 Σίγαση", unmute: "🔊 Ήχος", muted: "σίγαση", fixed: "σταθερή ένταση (π.χ. ήχος από HDMI ARC) — δεν αλλάζει από εφαρμογή",
  def: "Ένταση στο άναμμα %", max: "Μέγιστη %", enforce: "Επιβολή μεγίστου από την εφαρμογή (λογισμικό)", save: "Αποθήκευση πολιτικής",
  selected: "Επιλεγμένα", all: "Όλα", none: "Κανένα", applyPolicy: "Εφαρμογή πολιτικής στα επιλεγμένα", setSelected: "Ένταση στα επιλεγμένα",
  muteSelected: "Σίγαση επιλεγμένων", unmuteSelected: "Ήχος επιλεγμένων",
  agent_unknown: "δεν έχει αναφέρει", agent_offline: "εκτός σύνδεσης", agent_online: "συνδεδεμένη", agent_screen_on: "οθόνη αναμμένη", agent_screen_off: "οθόνη σβηστή",
  appOld: "Χρειάζεται Corali TV 1.9 (booking.hotelcorali.gr/tvapp)", APP_TOO_OLD: "χρειάζεται Corali TV 1.9", NO_SCREEN: "χωρίς τηλεόραση",
  queued: "Στάλθηκε σε {n} τηλεοράσεις· τα αποτελέσματα εμφανίζονται ανά δωμάτιο.", notQueued: "Δεν στάλθηκε: ", policySaved: "Η πολιτική αποθηκεύτηκε για {n} δωμάτια· εφαρμόζεται στον επόμενο έλεγχο κάθε τηλεόρασης (~20″).",
  clamped: "επαναφέρθηκε στο μέγιστο", failed: "Η ενέργεια απέτυχε.",
  st_PENDING: "⏳ αναμένει την TV", st_DELIVERED: "📨 αναμένεται επιβεβαίωση", st_EXECUTED: "✓ εκτελέστηκε", st_FAILED: "✗ απέτυχε", st_TIMEOUT: "⌛ δεν παραδόθηκε", st_UNVERIFIED: "? χωρίς επιβεβαίωση", st_CANCELLED: "ακυρώθηκε",
  cmd_SET_VOLUME: "Ένταση", cmd_VOLUME_UP: "Ένταση +", cmd_VOLUME_DOWN: "Ένταση −", cmd_MUTE: "Σίγαση", cmd_UNMUTE: "Ήχος", cmd_SCREEN_ON: "Άναμμα οθόνης", cmd_SCREEN_OFF: "Σβήσιμο οθόνης", cmd_SHOW_WELCOME: "Καλωσόρισμα",
  cap_volume: "Ένταση", cap_mute: "Σίγαση", cap_fixedVolume: "Σταθερή ένταση", cap_factoryApp: "Εργοστασιακή εφαρμογή", cap_factoryHotelMode: "hotel_mode", cap_factoryMaxVolume: "hotel_max_volume", cap_factoryPowerVolume: "hotel_power_volume", cap_factoryMenuLock: "hotel_menu_key_lock",
  unsupported: "Δεν υποστηρίζεται",
  unsupportedHelp: "Κλείδωμα μενού, κλείδωμα πηγής (HDMI) και εργοστασιακό όριο έντασης: η τηλεόραση έχει εργοστασιακές ρυθμίσεις Hotel Mode, αλλά καμία εξουσιοδοτημένη πρόσβαση για εφαρμογές. Οι τιμές τους εμφανίζονται μόνο για ενημέρωση (ανάγνωση) και δεν αλλάζουν από το PMS.",
  menuLock: "Κλείδωμα μενού", sourceLock: "Κλείδωμα πηγής",
  lockCol: "Κλείδωμα ρυθμίσεων TV (πραγματικό)", lk_LOCKED: "🔒 LOCKED", lk_UNLOCKED: "🔓 UNLOCKED", lk_PARTIAL: "⚠ PARTIAL (πλαϊνό πάνελ κλειστό από εργοστασιακό κλείδωμα)", lk_UNKNOWN: "UNKNOWN", lk_none: "UNKNOWN — χρειάζεται Corali TV 1.14+",
  lockHelp: "Διαβάζεται από την ίδια την TV. 🔒 LOCKED = η εφαρμογή Ρυθμίσεις της TV είναι απενεργοποιημένη: ο επισκέπτης δεν ανοίγει Wi-Fi, εφαρμογές, επαναφορά ή καμία άλλη ρύθμιση. Το πλαϊνό πάνελ του Google TV (εικόνα, ήχος, πηγές) μένει. Lock / Unlock από το PMS με Corali TV 1.18: η TV απενεργοποιεί / ενεργοποιεί τις Ρυθμίσεις μέσω του δικού της ADB (Self-ADB), χωρίς να εμφανίσει τίποτα στην οθόνη, ακόμα και σε αναμονή· «✓» μόνο όταν το Android δείξει μετά την αλλαγή ότι ισχύει και το Hotel Status είναι OFF. Το εργοστασιακό «Lock Menu Key» δεν χρησιμοποιείται: αλλάζει μόνο με εργοστασιακό Hotel Mode ON, που σε κάθε εκκίνηση απεγκαθιστά εφαρμογές. Το κλείδωμα μένει μετά από standby και επανεκκίνηση.",
  lockOn: "🔒 Κλείδωμα", lockOff: "🔓 Ξεκλείδωμα", lockSelected: "🔒 Κλείδωμα ρυθμίσεων στα επιλεγμένα", unlockSelected: "🔓 Ξεκλείδωμα ρυθμίσεων στα επιλεγμένα",
  lockConfirm: "{a} ρυθμίσεων TV στις τηλεοράσεις: {r};\n\nΗ TV {v} την εφαρμογή Ρυθμίσεις μέσω του Self-ADB. Δεν εμφανίζεται τίποτα στην οθόνη και δεν αλλάζει καμία εργοστασιακή ρύθμιση· το Hotel Status / Hotel Mode δεν αγγίζεται.",
  lockNeedsApp: "Lock / Unlock: χρειάζεται Corali TV 1.18 (η TV έχει {v})", lockRole: "Lock / Unlock: μόνο Owner / Admin", LOCK_APP_TOO_OLD: "χρειάζεται Corali TV 1.18", OWNER_ADMIN_ONLY: "μόνο Owner / Admin",
  err_GUEST_APP_IN_FRONT: "εφαρμογή επισκέπτη σε χρήση — δεν διακόπηκε", err_SCREEN_IS_OFF: "οθόνη σβηστή — ανάψτε την πρώτα", err_HOTEL_MODE_ON: "το Hotel Status είναι ON — δεν έγινε τίποτα", err_HOTEL_MODE_CHANGED: "⚠ άλλαξε το Hotel Status — ελέγξτε αμέσως την TV",
  err_ACCESSIBILITY_OFF: "η υπηρεσία προσβασιμότητας «Corali TV — κλείδωμα μενού» δεν είναι ενεργή", err_ACCESSIBILITY_NOT_CONNECTED: "η υπηρεσία προσβασιμότητας δεν συνδέθηκε", err_FACTORY_MENU_NOT_AVAILABLE: "το Factory Menu δεν άνοιξε",
  err_ENGINEER_PAGE_NOT_SHOWN: "η σελίδα Engineer Mode Option δεν εμφανίστηκε", err_LOCK_ROW_NOT_FOUND: "δεν βρέθηκε η γραμμή «Lock Menu Key»", err_LOCK_ROW_AMBIGUOUS: "βρέθηκαν πολλές γραμμές «Lock Menu Key» — δεν πατήθηκε τίποτα", err_LOCK_ROW_LABEL_MISMATCH: "η γραμμή δεν έχει την ετικέτα «Lock Menu Key» — δεν πατήθηκε τίποτα",
  err_LOCK_VALUE_UNREADABLE: "η τιμή της γραμμής δεν διαβάστηκε", err_FOCUS_REFUSED: "η γραμμή δεν δέχτηκε επιλογή", err_FOCUS_NOT_ON_LOCK_ROW: "η επιλογή δεν ήταν στη γραμμή — δεν στάλθηκε πλήκτρο", err_KEY_REFUSED: "το Android απέρριψε το πλήκτρο", err_KEY_NO_EFFECT: "το πλήκτρο δεν άλλαξε την τιμή",
  err_STATE_NOT_CONFIRMED: "η TV δεν επιβεβαίωσε τη νέα κατάσταση", err_STATE_PARTIAL: "μερικό κλείδωμα (PARTIAL)", err_NO_RESULT: "χωρίς αποτέλεσμα από την υπηρεσία", err_ANDROID_TOO_OLD: "χρειάζεται Android 13+", err_NO_STATE: "η TV δεν έστειλε κατάσταση", err_TURNED_ON_BY_REMOTE: "άναψε από το τηλεχειριστήριο / Cast",
  err_SELF_ADB_PORT_CLOSED: "το ADB της TV είναι κλειστό (Ασύρματος εντοπισμός σφαλμάτων)", err_SELF_ADB_AUTH_REJECTED: "η TV δεν έχει εγκρίνει το ADB του Corali TV", err_SELF_ADB_TIMEOUT: "το ADB της TV δεν απάντησε", err_SELF_ADB_COMMAND_FAILED: "η εντολή απορρίφθηκε από το Android",
  cmd_MENU_LOCK: "Κλείδωμα ρυθμίσεων", cmd_MENU_UNLOCK: "Ξεκλείδωμα ρυθμίσεων",
  openFactory: "Άνοιγμα Factory Menu στην TV", factoryConfirm: "Άνοιγμα του Factory Menu στην τηλεόραση του δωματίου {r};\n\nΜόνο για τεχνικό που βρίσκεται στο δωμάτιο. Στο μενού αλλάξτε ΜΟΝΟ: Engineer Mode Option → Lock Menu Key.\n\nΜην ενεργοποιήσετε το «Hotel Status / Hotel Mode»: σε κάθε εκκίνηση απεγκαθιστά το Corali TV και τις εφαρμογές τρίτων.",
  cmd_OPEN_FACTORY_MENU: "Factory Menu",
  noPerm: "Μόνο ανάγνωση (χρειάζεται δικαίωμα κρατήσεων για την ένταση / διαχειριστή για την πολιτική).",
  policyApplied: "πολιτική στην TV ✓", policyWaiting: "η TV δεν έχει πάρει ακόμα τη νέα πολιτική", policyUnknown: "επιβεβαίωση πολιτικής: χρειάζεται Corali TV 1.10",
  resets: "Επαναφορές (μόνο στα επιλεγμένα δωμάτια)", resetsHelp: "Αλλάζουν μόνο τις πολιτικές ήχου του ξενοδοχείου στην εφαρμογή. Δεν γίνεται εργοστασιακή επαναφορά, δεν αγγίζονται ρυθμίσεις του κατασκευαστή, ο σύνδεσμος του δωματίου, το Wi-Fi, η μέθοδος ρεύματος ή το καλωσόρισμα.",
  preset: "Προεπιλογές ξενοδοχείου", savePreset: "Αποθήκευση προεπιλογών",
  r_hotel_default: "Επαναφορά προεπιλογών ξενοδοχείου", r_no_max_enforcement: "Κατάργηση περιορισμού μέγιστης έντασης", r_restore_sound: "Επαναφορά ήχου τώρα", r_hotel_mode: "Επαναφορά Hotel Mode",
  d_hotel_default: "Πολιτική → ένταση στο άναμμα {d}%, μέγιστη {m}%, επιβολή {e}· μετά «Ήχος» (unmute).",
  d_no_max_enforcement: "Επιβολή μεγίστου → όχι (η ένταση στο άναμμα μένει). Δεν σημαίνει εργοστασιακό μέγιστο 100%.",
  d_restore_sound: "«Ήχος» (unmute) και ένταση στην ένταση εκκίνησης του δωματίου (με το όριο, αν ισχύει). Η πολιτική δεν αλλάζει.",
  d_hotel_mode: "Μόνο οι πολιτικές λογισμικού: πολιτική → {d}% / {m}% / επιβολή {e}, «Ήχος» και ένταση {d}%. Εργοστασιακές ρυθμίσεις: δεν αγγίζονται.",
  confirmRooms: "Δωμάτια", noFactory: "Δεν πραγματοποιείται εργοστασιακή επαναφορά.", typeCount: "Μαζική επαναφορά: γράψτε τον αριθμό των δωματίων ({n}) για επιβεβαίωση.", countMismatch: "Ο αριθμός δεν ταιριάζει — δεν έγινε τίποτα.",
  yes: "ναι", no: "όχι", selectFirst: "Επιλέξτε πρώτα δωμάτια.",
  emergency: "Emergency Unlock Menu", emergencyHelp: "«🔓 Ξεκλείδωμα» στη στήλη «Κλείδωμα ρυθμίσεων TV» (Corali TV 1.18, λειτουργεί και σε αναμονή). Αν το Self-ADB της TV δεν απαντά: με το τηλεχειριστήριο δεν ανοίγουν οι Ρυθμίσεις· ξεκλείδωμα από υπολογιστή με «adb shell pm enable --user 0 com.android.tv.settings», ή επαναφορά εργοστασιακών ρυθμίσεων ως έσχατη λύση.",
  fmOwnerOnly: "Άνοιγμα Factory Menu: μόνο ο Owner", fmNeedsApp: "Άνοιγμα Factory Menu: χρειάζεται Corali TV 1.14 (η TV έχει {v})", fmNoApp: "Άνοιγμα Factory Menu: η TV δεν έχει συνδεθεί ακόμα με το Corali TV",
  resultTitle: "Αποτέλεσμα επαναφοράς", res_PENDING: "⏳ σε αναμονή", res_DELIVERED: "📨 παραδόθηκε", res_EXECUTED: "✓ επιβεβαιώθηκε από την TV", res_UNVERIFIED: "? χωρίς επιβεβαίωση", res_FAILED: "✗ απέτυχε", res_OFFLINE: "TV εκτός σύνδεσης — η πολιτική θα εφαρμοστεί όταν συνδεθεί", res_APP_TOO_OLD: "χρειάζεται Corali TV 1.9+ (η πολιτική αποθηκεύτηκε)", res_SUPERSEDED: "αντικαταστάθηκε από νεότερη εντολή / επαναφορά",
  factoryUnsupported: "Εργοστασιακό κλείδωμα μενού: UNSUPPORTED (δεν αγγίχτηκε)", repeated: "Το ίδιο αίτημα είχε ήδη σταλεί — εμφανίζεται το αρχικό αποτέλεσμα.",
};
const EN: typeof EL = {
  ...EL,
  title: "Sound & Hotel Mode",
  help: "Volume is changed by the Corali TV app (1.9 or newer) over Wi-Fi. A command shows “✓” only when the TV read the real volume back afterwards. The “maximum” is a software limit of the app: if a guest goes above it with the remote, the app brings it back within seconds — it is not a factory lock.",
  room: "Room", state: "TV", volume: "Volume", policy: "Sound policy", caps: "Capabilities (as reported by the TV)", last: "Last command",
  set: "Set", mute: "🔇 Mute", unmute: "🔊 Unmute", muted: "muted", fixed: "fixed volume (e.g. sound over HDMI ARC) — cannot be changed by an app",
  def: "Power-on volume %", max: "Maximum %", enforce: "Enforce maximum in the app (software)", save: "Save policy",
  selected: "Selected", all: "All", none: "None", applyPolicy: "Apply policy to selected", setSelected: "Volume for selected",
  muteSelected: "Mute selected", unmuteSelected: "Unmute selected",
  agent_unknown: "never reported", agent_offline: "offline", agent_online: "connected", agent_screen_on: "screen on", agent_screen_off: "screen off",
  appOld: "Needs Corali TV 1.9 (booking.hotelcorali.gr/tvapp)", APP_TOO_OLD: "needs Corali TV 1.9", NO_SCREEN: "no TV",
  queued: "Sent to {n} TVs; results appear per room.", notQueued: "Not sent: ", policySaved: "Policy saved for {n} rooms; each TV applies it on its next check (~20″).",
  clamped: "brought back to the maximum", failed: "The action failed.",
  st_PENDING: "⏳ waiting for the TV", st_DELIVERED: "📨 awaiting confirmation", st_EXECUTED: "✓ executed", st_FAILED: "✗ failed", st_TIMEOUT: "⌛ not delivered", st_UNVERIFIED: "? not confirmed", st_CANCELLED: "cancelled",
  cmd_SET_VOLUME: "Volume", cmd_VOLUME_UP: "Volume +", cmd_VOLUME_DOWN: "Volume −", cmd_MUTE: "Mute", cmd_UNMUTE: "Unmute", cmd_SCREEN_ON: "Screen on", cmd_SCREEN_OFF: "Screen off", cmd_SHOW_WELCOME: "Welcome",
  cap_volume: "Volume", cap_mute: "Mute", cap_fixedVolume: "Fixed volume", cap_factoryApp: "Factory app",
  unsupported: "Not supported",
  unsupportedHelp: "Menu lock, source (HDMI) lock and the factory volume limit: the TV has factory Hotel Mode settings, but no authorised access for apps. Their values are shown for information only (read) and are not changed by the PMS.",
  menuLock: "Menu lock", sourceLock: "Source lock",
  lockCol: "TV settings lock (actual)", lk_LOCKED: "🔒 LOCKED", lk_UNLOCKED: "🔓 UNLOCKED", lk_PARTIAL: "⚠ PARTIAL (side panel closed by a factory lock)", lk_UNKNOWN: "UNKNOWN", lk_none: "UNKNOWN — needs Corali TV 1.14+",
  lockHelp: "Read on the TV itself. 🔒 LOCKED = the TV's Settings app is disabled: a guest cannot open Wi-Fi, apps, reset or any other setting. The Google TV side panel (picture, sound, inputs) stays. Lock / Unlock from the PMS with Corali TV 1.18: the TV disables / enables Settings through its own ADB (Self-ADB), showing nothing on screen, even in standby; “✓” only when Android shows afterwards that it holds and Hotel Status is OFF. The factory “Lock Menu Key” is not used: it can only be changed with the factory Hotel Mode ON, which uninstalls apps at every start. The lock stays after standby and restarts.",
  lockOn: "🔒 Lock", lockOff: "🔓 Unlock", lockSelected: "🔒 Lock settings on selected", unlockSelected: "🔓 Unlock settings on selected",
  lockConfirm: "{a} TV settings on the TVs: {r}?\n\nThe TV {v} its Settings app through Self-ADB. Nothing is shown on screen and no factory setting changes; Hotel Status / Hotel Mode is not touched.",
  lockNeedsApp: "Lock / Unlock: needs Corali TV 1.18 (the TV has {v})", lockRole: "Lock / Unlock: Owner / Admin only", LOCK_APP_TOO_OLD: "needs Corali TV 1.18", OWNER_ADMIN_ONLY: "Owner / Admin only",
  err_GUEST_APP_IN_FRONT: "guest app in use — not interrupted", err_SCREEN_IS_OFF: "screen off — turn it on first", err_HOTEL_MODE_ON: "Hotel Status is ON — nothing done", err_HOTEL_MODE_CHANGED: "⚠ Hotel Status changed — check the TV now",
  err_ACCESSIBILITY_OFF: "the accessibility service “Corali TV — κλείδωμα μενού” is off", err_ACCESSIBILITY_NOT_CONNECTED: "the accessibility service did not connect", err_FACTORY_MENU_NOT_AVAILABLE: "the Factory Menu did not open",
  err_ENGINEER_PAGE_NOT_SHOWN: "the Engineer Mode Option page did not appear", err_LOCK_ROW_NOT_FOUND: "“Lock Menu Key” row not found", err_LOCK_ROW_AMBIGUOUS: "several “Lock Menu Key” rows — nothing pressed", err_LOCK_ROW_LABEL_MISMATCH: "the row is not labelled “Lock Menu Key” — nothing pressed",
  err_LOCK_VALUE_UNREADABLE: "the row's value could not be read", err_FOCUS_REFUSED: "the row could not be selected", err_FOCUS_NOT_ON_LOCK_ROW: "the selection was not on the row — no key sent", err_KEY_REFUSED: "Android refused the key", err_KEY_NO_EFFECT: "the key did not change the value",
  err_STATE_NOT_CONFIRMED: "the TV did not confirm the new state", err_STATE_PARTIAL: "partial lock (PARTIAL)", err_NO_RESULT: "no result from the service", err_ANDROID_TOO_OLD: "needs Android 13+", err_NO_STATE: "the TV sent no state", err_TURNED_ON_BY_REMOTE: "turned on by the remote / Cast",
  err_SELF_ADB_PORT_CLOSED: "the TV's ADB is closed (wireless debugging)", err_SELF_ADB_AUTH_REJECTED: "the TV has not authorised Corali TV's ADB", err_SELF_ADB_TIMEOUT: "the TV's ADB did not answer", err_SELF_ADB_COMMAND_FAILED: "Android refused the command",
  cmd_MENU_LOCK: "Settings lock", cmd_MENU_UNLOCK: "Settings unlock",
  openFactory: "Open Factory Menu on the TV", factoryConfirm: "Open the Factory Menu on the TV of room {r}?\n\nOnly for a technician in the room. Change ONLY: Engineer Mode Option → Lock Menu Key.\n\nDo not turn on “Hotel Status / Hotel Mode”: it uninstalls Corali TV and third-party apps at every start.",
  cmd_OPEN_FACTORY_MENU: "Factory Menu",
  noPerm: "Read only (volume needs the reservations permission, the policy needs admin).",
  policyApplied: "policy on the TV ✓", policyWaiting: "the TV has not taken the new policy yet", policyUnknown: "policy confirmation needs Corali TV 1.10",
  resets: "Resets (selected rooms only)", resetsHelp: "They change only the hotel's sound policies in the app. No factory reset, no vendor settings; room link, Wi-Fi, power method and welcome screen are not touched.",
  preset: "Hotel defaults", savePreset: "Save defaults",
  r_hotel_default: "Reset to hotel defaults", r_no_max_enforcement: "Remove maximum volume limit", r_restore_sound: "Restore sound now", r_hotel_mode: "Reset Hotel Mode",
  d_hotel_default: "Policy → power-on {d}%, maximum {m}%, enforce {e}; then unmute.",
  d_no_max_enforcement: "Enforce maximum → no (power-on volume kept). It does not mean a factory maximum of 100%.",
  d_restore_sound: "Unmute and set the room's power-on volume (within the limit, if enforced). The policy is not changed.",
  d_hotel_mode: "Software policies only: policy → {d}% / {m}% / enforce {e}, unmute and volume {d}%. Factory settings are not touched.",
  confirmRooms: "Rooms", noFactory: "No factory reset is performed.", typeCount: "Bulk reset: type the number of rooms ({n}) to confirm.", countMismatch: "The number does not match — nothing was done.",
  yes: "yes", no: "no", selectFirst: "Select rooms first.",
  emergency: "Emergency Unlock Menu", emergencyHelp: "“🔓 Unlock” in the “TV settings lock” column (Corali TV 1.18, works in standby too). If the TV's Self-ADB does not answer: Settings cannot be opened with the remote; unlock from a computer with “adb shell pm enable --user 0 com.android.tv.settings”, or a factory reset as a last resort.",
  fmOwnerOnly: "Open Factory Menu: Owner only", fmNeedsApp: "Open Factory Menu: needs Corali TV 1.14 (the TV has {v})", fmNoApp: "Open Factory Menu: the TV has not connected with Corali TV yet",
  resultTitle: "Reset result", res_PENDING: "⏳ pending", res_DELIVERED: "📨 delivered", res_EXECUTED: "✓ confirmed by the TV", res_UNVERIFIED: "? not confirmed", res_FAILED: "✗ failed", res_OFFLINE: "TV offline — the policy applies when it connects", res_APP_TOO_OLD: "needs Corali TV 1.9+ (policy saved)", res_SUPERSEDED: "replaced by a newer command / reset",
  factoryUnsupported: "Factory menu lock: UNSUPPORTED (not touched)", repeated: "The same request had already been sent — showing its result.",
};

/** Corali TV versionCode → version name (versionCode 11 = 1.10, 12 = 1.11, …). */
const appName = (v: number) => (v >= 11 ? `1.${v - 1}` : v >= 9 ? "1.8+" : `v${v}`);

export function SoundManager({ lang, canCommand, canPolicy }: { lang: string; canCommand: boolean; canPolicy: boolean }) {
  const T = lang === "en" ? EN : EL;
  const tx = (k: string) => (T as Record<string, string>)[k] ?? k;
  const [data, setData] = useState<Data | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [vol, setVol] = useState<Record<number, number>>({});
  const [bulkVol, setBulkVol] = useState(30);
  const [edit, setEdit] = useState<Record<number, Policy>>({});
  const [bulkPolicy, setBulkPolicy] = useState<Policy>({ defaultVolume: 25, maxVolume: 50, enforceMax: true });
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [preset, setPreset] = useState<SoundPolicy | null>(null);
  const [reset, setReset] = useState<{ requestId: number; action: string; results: ResetResult[] } | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await (await fetch("/api/pms/tv/sound", { cache: "no-store" })).json();
      if (d.ok) { setData(d); setNow(Date.now()); }
    } catch { /* next tick */ }
  }, []);
  const waiting = data ? Object.values(data.commands).some((c) => !FINAL_STATUSES.includes(c.status as never)) : false;
  useEffect(() => {
    queueMicrotask(() => { void load(); });
    const id = window.setInterval(() => void load(), waiting ? 4_000 : 30_000);
    return () => window.clearInterval(id);
  }, [load, waiting]);

  useEffect(() => {
    if (!reset || reset.results.every((r) => FINAL_RESET.includes(r.status))) return;
    const id = window.setInterval(async () => {
      try {
        const r = await fetch("/api/pms/tv/sound", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reset_status", requestId: reset.requestId }) });
        const d = await r.json();
        if (d.ok) setReset({ requestId: d.requestId, action: d.action, results: d.results });
      } catch { /* next tick */ }
    }, 5_000);
    return () => window.clearInterval(id);
  }, [reset]);

  async function post(body: unknown) {
    setBusy(true); setMsg("");
    try {
      const r = await fetch("/api/pms/tv/sound", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!d.ok) { setMsg(`${T.failed}${d.error ? ` (${d.error})` : ""}`); return null; }
      return d;
    } finally { setBusy(false); }
  }
  async function command(roomIds: number[], cmd: string, value?: number) {
    const d = await post({ action: "command", roomIds, command: cmd, value });
    if (!d) return;
    const res = Object.entries(d.results as Record<string, { queued: boolean; error?: string }>);
    const ok = res.filter(([, r]) => r.queued).length;
    const bad = res.filter(([, r]) => !r.queued).map(([room, r]) => `${data?.screens.find((s) => s.room_id === Number(room))?.room_code ?? room}: ${tx(r.error ?? "")}`);
    setMsg(`${T.queued.replace("{n}", String(ok))}${bad.length ? ` ${T.notQueued}${bad.join(", ")}` : ""}`);
    setData((x) => (x ? { ...x, commands: d.commands } : x));
  }
  /** v167: Lock Menu Key on / off (owner / admin); one confirmation, and the number of rooms typed for several. */
  async function menuLock(roomIds: number[], lock: boolean) {
    if (!data || !roomIds.length) return;
    const codes = data.screens.filter((s) => roomIds.includes(s.room_id)).map((s) => s.room_code).join(", ");
    if (!window.confirm(T.lockConfirm.replace("{a}", lock ? T.lockOn : T.lockOff).replace("{v}", lock ? (lang === "en" ? "disables" : "απενεργοποιεί") : (lang === "en" ? "enables" : "ενεργοποιεί")).replace("{r}", codes))) return;
    if (roomIds.length > 1 && window.prompt(T.typeCount.replace("{n}", String(roomIds.length)))?.trim() !== String(roomIds.length)) { setMsg(T.countMismatch); return; }
    const d = await post({ action: "menu_lock", roomIds, lock, confirm: true });
    if (!d) return;
    const res = Object.entries(d.results as Record<string, { queued: boolean; error?: string }>);
    const ok = res.filter(([, r]) => r.queued).length;
    const bad = res.filter(([, r]) => !r.queued).map(([room, r]) => `${data.screens.find((s) => s.room_id === Number(room))?.room_code ?? room}: ${tx(r.error ?? "")}`);
    setMsg(`${T.queued.replace("{n}", String(ok))}${bad.length ? ` ${T.notQueued}${bad.join(", ")}` : ""}`);
    setData((x) => (x ? { ...x, commands: d.commands } : x));
  }
  async function savePolicy(roomIds: number[], p: Policy) {
    const d = await post({ action: "policy", roomIds, policy: { defaultVolume: p.defaultVolume, maxVolume: p.maxVolume, enforceMax: p.enforceMax } });
    if (!d) return;
    setMsg(T.policySaved.replace("{n}", String(d.saved.length)));
    setData((x) => (x ? { ...x, policies: d.policies } : x));
    setEdit((e) => { const n = { ...e }; for (const r of roomIds) delete n[r]; return n; });
  }

  const presetNow = preset ?? data?.preset ?? { defaultVolume: 8, maxVolume: 30, enforceMax: true };
  async function runReset(action: "hotel_default" | "no_max_enforcement" | "restore_sound" | "hotel_mode") {
    if (!data) return;
    const ids = [...sel];
    if (!ids.length) { setMsg(T.selectFirst); return; }
    const codes = data.screens.filter((s) => sel.has(s.room_id)).map((s) => s.room_code).join(", ");
    const desc = tx(`d_${action}`).replaceAll("{d}", String(presetNow.defaultVolume)).replaceAll("{m}", String(presetNow.maxVolume)).replaceAll("{e}", presetNow.enforceMax ? T.yes : T.no);
    if (!window.confirm(`${tx(`r_${action}`)}\n\n${desc}\n\n${T.confirmRooms} (${ids.length}): ${codes}\n\n${T.noFactory}`)) return;
    if (ids.length > 1 && window.prompt(T.typeCount.replace("{n}", String(ids.length)))?.trim() !== String(ids.length)) { setMsg(T.countMismatch); return; }
    const key = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}abcdef`;
    const d = await post(action === "restore_sound" ? { action, roomIds: ids, idempotencyKey: key } : { action: "reset_policy", roomIds: ids, preset: action, idempotencyKey: key });
    if (!d) return;
    setReset({ requestId: d.requestId, action: d.action, results: d.results });
    setMsg(d.repeated ? T.repeated : "");
    void load();
  }
  async function savePreset() {
    const d = await post({ action: "preset", preset: presetNow });
    if (d) { setPreset(d.preset); setMsg(T.policySaved.replace("{n}", "—")); }
  }

  if (!data) return null;
  const screens = data.screens.filter((s) => s.active === 1);
  const at = (ms: number | null) => (ms ? new Date(ms).toLocaleTimeString(lang === "en" ? "en-GB" : "el-GR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: "Europe/Athens" }) : "");
  const pctInput = (v: number | null, on: (n: number | null) => void, disabled: boolean) => (
    <input type="number" min={0} max={100} style={{ width: "4.5em" }} value={v ?? ""} disabled={disabled} onChange={(e) => on(e.target.value === "" ? null : Math.max(0, Math.min(100, Number(e.target.value))))} />
  );
  const selected = [...sel];

  return (
    <Fold card title={T.title}>
      <small>{T.help}</small>
      {!canCommand && !canPolicy && <p className="muted">{T.noPerm}</p>}
      <p className="notice"><b>{T.menuLock} (Lock / Unlock): Corali TV 1.18 · {T.sourceLock}: {T.unsupported}</b><br /><small>{T.lockHelp}</small><br /><small>{T.unsupportedHelp}</small></p>

      <div className="tvAdminChecks">
        <b>{T.selected}: {selected.length}</b>
        <button type="button" className="secondaryButton" onClick={() => setSel(new Set(screens.map((s) => s.room_id)))}>{T.all}</button>
        <button type="button" className="secondaryButton" onClick={() => setSel(new Set())}>{T.none}</button>
        {canCommand && <>
          <label className="inline">{T.setSelected} {pctInput(bulkVol, (n) => setBulkVol(n ?? 0), busy)}%</label>
          <button type="button" disabled={busy || !selected.length} onClick={() => void command(selected, "SET_VOLUME", bulkVol)}>{T.set}</button>
          <button type="button" className="secondaryButton" disabled={busy || !selected.length} onClick={() => void command(selected, "MUTE")}>{T.muteSelected}</button>
          <button type="button" className="secondaryButton" disabled={busy || !selected.length} onClick={() => void command(selected, "UNMUTE")}>{T.unmuteSelected}</button>
        </>}
        {data.canMenuLock && <>
          <button type="button" className="secondaryButton" disabled={busy || !selected.length} onClick={() => void menuLock(selected, true)}>{T.lockSelected}</button>
          <button type="button" className="secondaryButton" disabled={busy || !selected.length} onClick={() => void menuLock(selected, false)}>{T.unlockSelected}</button>
        </>}
      </div>
      {canPolicy && (
        <div className="tvAdminChecks">
          <label className="inline">{T.def} {pctInput(bulkPolicy.defaultVolume, (n) => setBulkPolicy({ ...bulkPolicy, defaultVolume: n }), busy)}</label>
          <label className="inline">{T.max} {pctInput(bulkPolicy.maxVolume, (n) => setBulkPolicy({ ...bulkPolicy, maxVolume: n }), busy)}</label>
          <label className="inline"><input type="checkbox" checked={bulkPolicy.enforceMax} onChange={(e) => setBulkPolicy({ ...bulkPolicy, enforceMax: e.target.checked })} /> {T.enforce}</label>
          <button type="button" disabled={busy || !selected.length} onClick={() => void savePolicy(selected, bulkPolicy)}>{T.applyPolicy}</button>
        </div>
      )}

      {(canPolicy || canCommand) && (
        <Fold title={T.resets}>
          <small>{T.resetsHelp}</small>
          {canPolicy && <div className="tvAdminChecks">
            <b>{T.preset}:</b>
            <label className="inline">{T.def} {pctInput(presetNow.defaultVolume, (n) => setPreset({ ...presetNow, defaultVolume: n ?? 0 }), busy)}</label>
            <label className="inline">{T.max} {pctInput(presetNow.maxVolume, (n) => setPreset({ ...presetNow, maxVolume: n ?? 0 }), busy)}</label>
            <label className="inline"><input type="checkbox" checked={presetNow.enforceMax} onChange={(e) => setPreset({ ...presetNow, enforceMax: e.target.checked })} /> {T.enforce}</label>
            <button type="button" className="secondaryButton" disabled={busy} onClick={() => void savePreset()}>{T.savePreset}</button>
          </div>}
          <div className="tvAdminChecks">
            {canPolicy && <button type="button" disabled={busy || !selected.length} onClick={() => void runReset("hotel_default")}>{T.r_hotel_default}</button>}
            {canPolicy && <button type="button" className="secondaryButton" disabled={busy || !selected.length} onClick={() => void runReset("no_max_enforcement")}>{T.r_no_max_enforcement}</button>}
            {canCommand && <button type="button" className="secondaryButton" disabled={busy || !selected.length} onClick={() => void runReset("restore_sound")}>{T.r_restore_sound}</button>}
            {canPolicy && <button type="button" className="secondaryButton" disabled={busy || !selected.length} onClick={() => void runReset("hotel_mode")}>{T.r_hotel_mode}</button>}
          </div>
          {canPolicy && <small className="muted">{T.emergency}: {T.emergencyHelp}</small>}
          {reset && (
            <div className="notice" role="status">
              <b>{T.resultTitle}: {tx(`r_${reset.action}`)}</b>
              <ul className="plainList">{reset.results.map((r) => (
                <li key={r.roomId}><b>{r.roomCode}</b> — <span className={r.status === "EXECUTED" ? "credit" : ["FAILED", "OFFLINE", "UNVERIFIED", "APP_TOO_OLD"].includes(r.status) ? "debit" : ""}>{tx(`res_${r.status}`)}</span>{reset.action === "hotel_mode" ? <small className="muted"> · {T.factoryUnsupported}</small> : null}</li>
              ))}</ul>
            </div>
          )}
        </Fold>
      )}

      <div className="tableWrap"><table>
        <thead><tr><th /><th>{T.room}</th><th>{T.state}</th><th>{T.volume}</th><th>{T.policy}</th><th>{T.lockCol}</th><th>{T.caps}</th><th>{T.last}</th></tr></thead>
        <tbody>{screens.map((s) => {
          const st = agentState(s.screen_seen_at, s.screen_interactive, now);
          const old = s.app_version === null || s.app_version < data.soundApp;
          const p = edit[s.room_id] ?? data.policies[s.room_id] ?? { defaultVolume: null, maxVolume: null, enforceMax: false };
          const c = data.commands[s.room_id];
          const v = vol[s.room_id] ?? s.volume_percent ?? 30;
          const caps = Object.entries(s.caps ?? {});
          return (
            <tr key={s.room_id}>
              <td><input type="checkbox" aria-label={s.room_code} checked={sel.has(s.room_id)} onChange={(e) => setSel((x) => { const n = new Set(x); if (e.target.checked) n.add(s.room_id); else n.delete(s.room_id); return n; })} /></td>
              <td><b>{s.room_code}</b></td>
              <td><small className={st === "offline" || st === "unknown" ? "debit" : "credit"}>{tx(`agent_${st}`)}</small>{s.screen_seen_at ? <small className="muted"> · {at(s.screen_seen_at)}</small> : null}{old && <><br /><small className="muted">{T.appOld}</small></>}</td>
              <td>
                {s.volume_percent !== null ? <b>{s.volume_percent}%{s.volume_muted === 1 ? ` · ${T.muted}` : ""}</b> : <span className="muted">—</span>}
                {s.volume_fixed === 1 && <><br /><small className="debit">{T.fixed}</small></>}
                {s.policy_clamped_at && <><br /><small className="muted">{T.clamped} {at(s.policy_clamped_at)}</small></>}
                {canCommand && !old && <div className="apRow">
                  <input type="range" min={0} max={100} value={v} disabled={busy} onChange={(e) => setVol({ ...vol, [s.room_id]: Number(e.target.value) })} aria-label={T.volume} />
                  <span>{v}%</span>
                  <button type="button" className="secondaryButton" disabled={busy} onClick={() => void command([s.room_id], "SET_VOLUME", v)}>{T.set}</button>
                  <button type="button" className="secondaryButton" disabled={busy} onClick={() => void command([s.room_id], "VOLUME_DOWN")}>−</button>
                  <button type="button" className="secondaryButton" disabled={busy} onClick={() => void command([s.room_id], "VOLUME_UP")}>+</button>
                  <button type="button" className="secondaryButton" disabled={busy} onClick={() => void command([s.room_id], s.volume_muted === 1 ? "UNMUTE" : "MUTE")}>{s.volume_muted === 1 ? T.unmute : T.mute}</button>
                </div>}
              </td>
              <td>
                <label className="inline">{T.def} {pctInput(p.defaultVolume, (n) => setEdit({ ...edit, [s.room_id]: { ...p, defaultVolume: n } }), !canPolicy || busy)}</label>
                <label className="inline">{T.max} {pctInput(p.maxVolume, (n) => setEdit({ ...edit, [s.room_id]: { ...p, maxVolume: n } }), !canPolicy || busy)}</label>
                <label className="inline"><input type="checkbox" checked={p.enforceMax} disabled={!canPolicy || busy} onChange={(e) => setEdit({ ...edit, [s.room_id]: { ...p, enforceMax: e.target.checked } })} /> {T.enforce}</label>
                {canPolicy && edit[s.room_id] && <button type="button" className="secondaryButton" disabled={busy} onClick={() => void savePolicy([s.room_id], p)}>{T.save}</button>}
                {data.policies[s.room_id] && !old && <small className={s.policy_rev_applied !== null && data.policies[s.room_id].rev !== undefined && s.policy_rev_applied >= Number(data.policies[s.room_id].rev) ? "credit" : "muted"}>{s.app_version !== null && s.app_version < 11 ? T.policyUnknown : s.policy_rev_applied !== null && s.policy_rev_applied >= Number(data.policies[s.room_id].rev) ? T.policyApplied : T.policyWaiting}</small>}
              </td>
              <td>
                {s.menu_lock_state ? <><b className={s.menu_lock_state === "LOCKED" ? "credit" : s.menu_lock_state === "UNKNOWN" ? "muted" : "debit"}>{tx(`lk_${s.menu_lock_state}`)}</b>{s.menu_lock_seen_at ? <small className="muted"> · {at(s.menu_lock_seen_at)}</small> : null}</> : <small className="muted">{T.lk_none}</small>}
                {(!data.isOwner || s.app_version === null || s.app_version < (data.factoryMenuApp ?? 15)) && <><br /><small className="muted">{!data.isOwner ? T.fmOwnerOnly : s.app_version === null ? T.fmNoApp : T.fmNeedsApp.replace("{v}", appName(s.app_version))}</small></>}
                {data.canMenuLock && s.app_version !== null && s.app_version >= (data.menuLockApp ?? 19) && <div className="apRow">
                  <button type="button" className={s.menu_lock_state === "LOCKED" ? "secondaryButton" : ""} disabled={busy} onClick={() => void menuLock([s.room_id], true)}>{T.lockOn}</button>
                  <button type="button" className={s.menu_lock_state === "LOCKED" ? "" : "secondaryButton"} disabled={busy} onClick={() => void menuLock([s.room_id], false)}>{T.lockOff}</button>
                </div>}
                {s.app_version !== null && (!data.canMenuLock || s.app_version < (data.menuLockApp ?? 19)) && <><br /><small className="muted">{!data.canMenuLock ? T.lockRole : T.lockNeedsApp.replace("{v}", appName(s.app_version))}</small></>}
                {data.isOwner && s.app_version !== null && s.app_version >= (data.factoryMenuApp ?? 15) && <><br /><button type="button" className="secondaryButton" disabled={busy} onClick={() => { if (window.confirm(T.factoryConfirm.replace("{r}", s.room_code))) void post({ action: "factory_menu", roomId: s.room_id, confirm: true }).then((d) => { if (d) void load(); }); }}>{T.openFactory}</button></>}
              </td>
              <td>{caps.length ? <small>{caps.map(([k, val]) => `${tx(`cap_${k}`)}: ${val ?? "—"}`).join(" · ")}</small> : <span className="muted">—</span>}</td>
              <td>{c ? <small className={c.status === "EXECUTED" ? "credit" : ["FAILED", "TIMEOUT", "UNVERIFIED"].includes(c.status) ? "debit" : ""}>{tx(`cmd_${c.command}`)}{c.value !== null ? ` ${c.value}%` : ""}{c.cap !== null && ["SET_VOLUME", "VOLUME_UP", "VOLUME_DOWN"].includes(c.command) ? ` (≤${c.cap}%)` : ""} · {at(c.created_at)} → <b>{tx(`st_${c.status}`)}</b>{c.result_volume !== null ? ` · ${c.result_volume}%` : ""}{c.result_muted === 1 ? ` · ${T.muted}` : ""}{c.error ? ` · ${(T as Record<string, string>)[`err_${c.error}`] ?? c.error}` : ""}</small> : <span className="muted">—</span>}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
      {msg && <p className="notice" role="status">{msg}</p>}
    </Fold>
  );
}
