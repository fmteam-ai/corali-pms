// v193 Guest Experience Root Cause Analytics: recurring causes behind guests' requests and ratings (90 days), each with
// the evidence, the sample size, and a concrete suggestion — e.g. «room 112: air conditioning reported 4 times in 3
// different stays, those stays rated 3.2 vs 4.6 for the hotel → technical check of the unit». A rating difference is
// shown as an association, not as proof of the cause, and findings with too small a sample are not shown.
const DAY = 86_400_000;
export const MIN_REPEATS = 3, MIN_STAYS = 2, MIN_RATED = 2, SYSTEMIC_ROOMS = 4;

export const PROBLEM_LABELS = { ac: "Κλιματιστικό", hot_water: "Ζεστό νερό", water_leak: "Διαρροή νερού", wifi: "Wi-Fi", tv: "Τηλεόραση", electrical: "Ρεύμα / πρίζες", lighting: "Φωτισμός", door_lock: "Πόρτα / κλειδαριά", safe: "Χρηματοκιβώτιο", noise: "Θόρυβος", cleaning: "Καθαριότητα", other: "Άλλο" };
export const SUGGESTIONS = {
  ac: "τεχνικός έλεγχος της μονάδας κλιματισμού (φίλτρα, ψυκτικό υγρό, θερμοστάτης, αποχέτευση)",
  hot_water: "έλεγχος θερμοσίφωνα / μπόιλερ και αναμεικτικής βαλβίδας του δωματίου",
  water_leak: "υδραυλικός έλεγχος (σιφώνια, σωληνώσεις, σιλικόνες)",
  wifi: "έλεγχος σήματος Wi-Fi στο δωμάτιο (θέση access point, παρεμβολές)",
  tv: "έλεγχος τηλεόρασης / εφαρμογής Corali TV και της σύνδεσής της",
  electrical: "έλεγχος από ηλεκτρολόγο (πρίζες, ασφάλειες, γείωση)",
  lighting: "έλεγχος φωτιστικών και διακοπτών",
  door_lock: "έλεγχος κλειδαριάς / μπαταρίας και ρύθμιση πόρτας",
  safe: "έλεγχος / αλλαγή μπαταρίας χρηματοκιβωτίου",
  noise: "έλεγχος πηγής θορύβου (μηχανήματα, μόνωση, γειτονικοί χώροι)",
  cleaning: "επανεκπαίδευση / λίστα ελέγχου καθαρισμού για το δωμάτιο",
  other: "έλεγχος των σημειώσεων των αιτημάτων",
};

/** Free-text fault descriptions → a problem category (Greek and English keywords). */
export function categorize(text) {
  const t = String(text ?? "").toLowerCase();
  const rules = [
    ["ac", /κλιματ|a\/c|\bac\b|air ?con|aircondition|κλιματιστ|ψύξη|θέρμανσ|καλοριφ/],
    ["hot_water", /ζεστό νερό|ζεστο νερο|θερμοσίφ|θερμοσιφ|μπόιλερ|boiler|hot water/],
    ["water_leak", /διαρρο|στάζ|σταζ|leak|βουλωμ|αποχέτ|σιφών|clog/],
    ["wifi", /wi-?fi|internet|ίντερνετ|ιντερνετ/],
    ["tv", /τηλεόρ|τηλεορ|\btv\b|τηλεχειρ|remote/],
    ["electrical", /πρίζ|πριζ|ρεύμα|ρευμα|ασφάλει|socket|power|electric/],
    ["lighting", /λάμπ|λαμπ|φως|φώτα|φωτισ|light|bulb/],
    ["door_lock", /κλειδαρ|πόρτα|πορτα|lock|door|κάρτα πόρτ/],
    ["safe", /χρηματοκιβ|\bsafe\b/],
    ["noise", /θόρυβ|θορυβ|noise|noisy/],
  ];
  for (const [k, re] of rules) if (re.test(t)) return k;
  return "other";
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/**
 * Pure: findings from the events (problems per room and stay), the ratings per stay, and handling times.
 * events: [{ roomId, code, bookingId, category, at, source }]; ratings: [{ bookingId, roomId, rating }];
 * handling: [{ kind, minutes }].
 */
export function findRootCauses({ events, ratings, handling = [] }) {
  const findings = [];
  const hotelAvg = avg(ratings.map((r) => Number(r.rating)));
  const ratingOf = new Map(ratings.map((r) => [Number(r.bookingId), Number(r.rating)]));
  // 1) The same problem in the same room, again and again (in different stays).
  const byRoomCat = new Map();
  for (const e of events) {
    const k = `${e.roomId}|${e.category}`;
    if (!byRoomCat.has(k)) byRoomCat.set(k, { roomId: e.roomId, code: e.code, category: e.category, events: [] });
    byRoomCat.get(k).events.push(e);
  }
  for (const g of byRoomCat.values()) {
    if (g.category === "other") continue;
    const stays = [...new Set(g.events.map((e) => e.bookingId).filter(Boolean))];
    if (g.events.length < MIN_REPEATS || stays.length < MIN_STAYS) continue;
    const rated = stays.map((b) => ratingOf.get(Number(b))).filter((x) => x !== undefined);
    const stayAvg = avg(rated);
    const lower = rated.length >= MIN_RATED && hotelAvg !== null && stayAvg !== null && hotelAvg - stayAvg >= 0.5;
    findings.push({
      key: `room:${g.roomId}:${g.category}`, kind: "recurring_room", severity: lower || g.events.length >= 5 ? "high" : "medium", roomId: g.roomId, code: g.code, category: g.category,
      title: `Δωμάτιο ${g.code}: «${PROBLEM_LABELS[g.category]}» ${g.events.length} φορές σε ${stays.length} διαφορετικές διαμονές`,
      evidence: [
        `τελευταία φορά ${new Date(Math.max(...g.events.map((e) => Number(e.at)))).toISOString().slice(0, 10)}`,
        ...(rated.length >= MIN_RATED && stayAvg !== null && hotelAvg !== null ? [`αυτές οι διαμονές βαθμολογήθηκαν κατά μέσο όρο ${stayAvg.toFixed(1)}/5 (${rated.length} αξιολογήσεις) έναντι ${hotelAvg.toFixed(1)}/5 του ξενοδοχείου — συσχέτιση, όχι απόδειξη αιτίας`] : [`χωρίς αρκετές αξιολογήσεις για σύγκριση (${rated.length})`]),
      ],
      suggestion: `Προτείνεται ${SUGGESTIONS[g.category]} στο δωμάτιο ${g.code}.`,
      sample: g.events.length,
    });
  }
  // 2) The same problem in many rooms: probably a shared cause (network, central installation, supplier).
  const byCat = new Map();
  for (const e of events) { if (e.category === "other") continue; if (!byCat.has(e.category)) byCat.set(e.category, new Map()); const m = byCat.get(e.category); m.set(e.roomId, (m.get(e.roomId) ?? 0) + 1); }
  for (const [cat, rooms] of byCat) {
    if (rooms.size < SYSTEMIC_ROOMS) continue;
    const total = [...rooms.values()].reduce((a, b) => a + b, 0);
    findings.push({ key: `systemic:${cat}`, kind: "systemic", severity: "high", category: cat, title: `«${PROBLEM_LABELS[cat]}» σε ${rooms.size} διαφορετικά δωμάτια (${total} φορές)`, evidence: [`πιθανό κοινό αίτιο — όχι πρόβλημα ενός δωματίου`], suggestion: cat === "wifi" ? "Προτείνεται έλεγχος του δικτύου (router / access points / πάροχος) και όχι ανά δωμάτιο." : cat === "hot_water" ? "Προτείνεται έλεγχος της κεντρικής εγκατάστασης ζεστού νερού." : `Προτείνεται έλεγχος κοινής αιτίας για «${PROBLEM_LABELS[cat]}» (εγκατάσταση, προμηθευτής, ρυθμίσεις).`, sample: total });
  }
  // 3) A room rated clearly lower than the hotel with no recorded problem: look at the comments.
  const byRoomRatings = new Map();
  for (const r of ratings) { if (!byRoomRatings.has(r.roomId)) byRoomRatings.set(r.roomId, []); byRoomRatings.get(r.roomId).push(Number(r.rating)); }
  for (const [roomId, rs] of byRoomRatings) {
    if (rs.length < 3 || hotelAvg === null) continue;
    const a = avg(rs);
    if (hotelAvg - a < 0.7) continue;
    if (events.some((e) => e.roomId === roomId)) continue;
    const code = ratings.find((r) => r.roomId === roomId)?.code ?? String(roomId);
    findings.push({ key: `lowroom:${roomId}`, kind: "low_rated_room", severity: "medium", roomId, code, title: `Δωμάτιο ${code}: μέση βαθμολογία ${a.toFixed(1)}/5 (${rs.length} αξιολογήσεις) έναντι ${hotelAvg.toFixed(1)}/5`, evidence: ["χωρίς καταγεγραμμένο αίτημα ή βλάβη — η αιτία δεν φαίνεται στα δεδομένα"], suggestion: "Προτείνεται ανάγνωση των σχολίων των αξιολογήσεων και επιθεώρηση του δωματίου (θόρυβος, θέα, στρώματα, μόνωση).", sample: rs.length });
  }
  // 4) Slow handling of a kind of request.
  const byKind = new Map();
  for (const h of handling) { if (!byKind.has(h.kind)) byKind.set(h.kind, []); byKind.get(h.kind).push(Number(h.minutes)); }
  for (const [kind, ms] of byKind) {
    if (ms.length < 5) continue;
    const sorted = [...ms].sort((a, b) => a - b), median = sorted[Math.floor(sorted.length / 2)];
    if (median <= 60) continue;
    findings.push({ key: `slow:${kind}`, kind: "slow_response", severity: "medium", title: `Αιτήματα «${kind}»: διάμεσος χρόνος εξυπηρέτησης ${Math.round(median)}′ (${ms.length} αιτήματα)`, evidence: [`ταχύτερο ${Math.round(sorted[0])}′, πιο αργό ${Math.round(sorted.at(-1))}′`], suggestion: "Προτείνεται έλεγχος βάρδιας / ειδοποιήσεων του τμήματος που τα εξυπηρετεί.", sample: ms.length });
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity] || b.sample - a.sample);
}

/** Gathers 90 days of events and ratings and returns the findings. */
export async function rootCauses({ pool, owner, now = Date.now(), days = 90 }) {
  const since = now - days * DAY;
  const q = (sql, p) => pool.query(sql, p).then((r) => r.rows);
  const [reqs, faults, ratings, handled, done] = await Promise.all([
    q(`SELECT q.id,q.room_id,r.code,q.booking_id,q.kind,q.details_json,q.created_at FROM tv_requests q JOIN rooms r ON r.owner_id=q.owner_id AND r.id=q.room_id WHERE q.owner_id=$1 AND q.created_at>=$2 AND q.kind='problem'`, [owner, since]).catch(() => []),
    q(`SELECT m.id,m.room_id,r.code,m.description,m.reported_at,(SELECT b.id FROM bookings b WHERE b.owner_id=m.owner_id AND b.room_id=m.room_id AND b.check_in<=to_char(to_timestamp(m.reported_at/1000) AT TIME ZONE 'Europe/Athens','YYYY-MM-DD') AND b.check_out>=to_char(to_timestamp(m.reported_at/1000) AT TIME ZONE 'Europe/Athens','YYYY-MM-DD') AND b.status IN ('checked_in','checked_out') ORDER BY b.check_in DESC LIMIT 1) booking_id FROM maintenance_notices m JOIN rooms r ON r.owner_id=m.owner_id AND r.id=m.room_id WHERE m.owner_id=$1 AND m.reported_at>=$2 AND m.description NOT LIKE '[Ανάλυση αιτιών]%'`, [owner, since]).catch(() => []),
    q(`SELECT v.booking_id,v.rating,b.room_id,r.code FROM review_requests v JOIN bookings b ON b.owner_id=v.owner_id AND b.id=v.booking_id LEFT JOIN rooms r ON r.owner_id=b.owner_id AND r.id=b.room_id WHERE v.owner_id=$1 AND v.rating IS NOT NULL AND v.rated_at>=$2 AND b.room_id IS NOT NULL`, [owner, since]).catch(() => []),
    q(`SELECT kind,(handled_at-created_at)/60000.0 minutes FROM tv_requests WHERE owner_id=$1 AND created_at>=$2 AND handled_at IS NOT NULL AND kind NOT IN ('dnd_on','dnd_off','instay_good')`, [owner, since]).catch(() => []),
    q(`SELECT finding_key,status,maintenance_id,updated_at FROM root_cause_actions WHERE owner_id=$1`, [owner]).catch(() => []),
  ]);
  const events = [
    ...reqs.map((x) => { let d = {}; try { d = (typeof x.details_json === "object" ? x.details_json : JSON.parse(String(x.details_json ?? "{}"))) ?? {}; } catch { d = {}; } return { roomId: Number(x.room_id), code: String(x.code), bookingId: x.booking_id ? Number(x.booking_id) : null, category: PROBLEM_LABELS[d.problem] ? d.problem : "other", at: Number(x.created_at), source: "tv" }; }),
    ...faults.map((x) => ({ roomId: Number(x.room_id), code: String(x.code), bookingId: x.booking_id ? Number(x.booking_id) : null, category: categorize(x.description), at: Number(x.reported_at), source: "maintenance" })),
  ];
  const findings = findRootCauses({ events, ratings: ratings.map((r) => ({ bookingId: Number(r.booking_id), roomId: Number(r.room_id), code: String(r.code), rating: Number(r.rating) })), handling: handled.map((h) => ({ kind: String(h.kind), minutes: Number(h.minutes) })) });
  const actions = new Map(done.map((d) => [String(d.finding_key), d]));
  // v194: for findings with a maintenance task, whether the fix worked (recurrences and clean stays after it).
  const mIds = done.filter((d) => d.maintenance_id).map((d) => Number(d.maintenance_id));
  const [fixes, staysAfter] = mIds.length ? await Promise.all([
    q(`SELECT id,room_id,status,resolved_at FROM maintenance_notices WHERE owner_id=$1 AND id=ANY($2::bigint[])`, [owner, mIds]),
    q(`SELECT room_id,checked_out_at FROM bookings WHERE owner_id=$1 AND status='checked_out' AND checked_out_at IS NOT NULL AND checked_out_at>=$2`, [owner, now - 365 * DAY]),
  ]) : [[], []];
  const withAction = (f) => {
    const a = actions.get(f.key);
    if (!a) return { ...f, action: null };
    const action = { status: a.status, maintenanceId: a.maintenance_id ? Number(a.maintenance_id) : null, at: Number(a.updated_at), note: String(a.note ?? "") };
    if (a.status !== "maintenance" || !action.maintenanceId) return { ...f, action };
    const fix = fixes.find((x) => Number(x.id) === action.maintenanceId);
    const resolvedAt = fix?.status === "resolved" && fix.resolved_at ? Number(fix.resolved_at) : null;
    const eventsAfter = resolvedAt ? events.filter((e) => e.roomId === f.roomId && e.category === f.category && e.at > resolvedAt).length : 0;
    const stays = resolvedAt ? staysAfter.filter((b) => Number(b.room_id) === f.roomId && Number(b.checked_out_at) > resolvedAt).length : 0;
    const resolution = resolutionState({ resolvedAt, eventsAfter, staysAfter: stays });
    return { ...f, severity: resolution.state === "recurred" ? "high" : f.severity, action: { ...action, resolution } };
  };
  return { at: now, days, events: events.length, ratings: ratings.length, findings: findings.map(withAction) };
}

/** v194: a dismissal needs a real reason — at least 10 characters with letters, not just punctuation or repeats. */
export function meaningfulReason(text) {
  const t = String(text ?? "").trim();
  const letters = (t.match(/\p{L}/gu) ?? []).length;
  return t.length >= 10 && letters >= 6 && new Set(t.toLowerCase().replace(/\s/g, "")).size >= 4;
}

/**
 * «Δημιουργία εργασίας συντήρησης» from a room finding, or «Αγνόηση» with a reason. v194: atomic and idempotent — one
 * transaction claims the finding first (unique key per hotel and finding), then creates the task; two people clicking
 * at the same time get one task (the second sees «already»).
 */
export async function actOnFinding({ pool, owner, key, action, userId = null, reason = "", now = Date.now() }) {
  if (action === "dismiss" && !meaningfulReason(reason)) return { ok: false, error: "REASON_REQUIRED" };
  let finding = null;
  if (action === "maintenance") {
    const r = await rootCauses({ pool, owner, now });
    finding = r.findings.find((x) => x.key === key);
    if (!finding || !finding.roomId) return { ok: false, error: "NOT_A_ROOM_FINDING" };
  }
  const client = typeof pool.connect === "function" ? await pool.connect() : pool;
  try {
    await client.query("BEGIN");
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`rootcause:${owner}:${key}`]);
    if (action === "maintenance") {
      // Atomic claim on the unique (hotel, finding) key: only the transaction that inserts / takes over the row goes
      // on to create the task; a concurrent one waits on that row and then finds it claimed.
      const claim = await client.query(
        `INSERT INTO root_cause_actions(owner_id,finding_key,status,created_by,updated_at) VALUES($1,$2,'creating',$3,$4)
         ON CONFLICT(owner_id,finding_key) DO UPDATE SET status='creating',created_by=$3,updated_at=$4 WHERE root_cause_actions.status='dismissed' RETURNING finding_key`,
        [owner, key, userId, now],
      );
      if (!claim.rows.length) {
        const ex = (await client.query(`SELECT maintenance_id FROM root_cause_actions WHERE owner_id=$1 AND finding_key=$2`, [owner, key])).rows[0];
        await client.query("ROLLBACK");
        return { ok: true, already: true, maintenanceId: ex?.maintenance_id ? Number(ex.maintenance_id) : undefined };
      }
    } else {
      const existing = (await client.query(`SELECT status FROM root_cause_actions WHERE owner_id=$1 AND finding_key=$2 FOR UPDATE`, [owner, key])).rows[0];
      if (existing && existing.status !== "dismissed") { await client.query("ROLLBACK"); return { ok: false, error: "HAS_TASK" }; }
    }
    if (action === "dismiss") {
      await client.query(`INSERT INTO root_cause_actions(owner_id,finding_key,status,note,created_by,updated_at) VALUES($1,$2,'dismissed',$3,$4,$5) ON CONFLICT(owner_id,finding_key) DO UPDATE SET status='dismissed',note=$3,created_by=$4,updated_at=$5`, [owner, key, String(reason).trim().slice(0, 300), userId, now]);
      await client.query("COMMIT");
      return { ok: true };
    }
    const m = await client.query(`INSERT INTO maintenance_notices(owner_id,room_id,severity,description,reported_by,reported_at) VALUES($1,$2,'minor',$3,$4,$5) RETURNING id`, [owner, finding.roomId, `[Ανάλυση αιτιών] ${finding.title}. ${finding.suggestion}`.slice(0, 900), userId, now]);
    const id = Number(m.rows[0].id);
    await client.query(`INSERT INTO root_cause_actions(owner_id,finding_key,status,maintenance_id,created_by,updated_at) VALUES($1,$2,'maintenance',$3,$4,$5) ON CONFLICT(owner_id,finding_key) DO UPDATE SET status='maintenance',maintenance_id=$3,note='',created_by=$4,updated_at=$5`, [owner, key, id, userId, now]);
    await client.query("COMMIT");
    return { ok: true, maintenanceId: id };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally { if (client !== pool) { try { client.release?.(); } catch { /* released */ } } }
}

/**
 * v194 resolution tracking: did the intervention fix it? For a room finding with a maintenance task:
 *   open_task  — the task is not resolved yet;
 *   recurred   — the same problem was reported in that room after the task was resolved (it did not fix it);
 *   effective  — at least `stays` stays in that room checked out after the fix without the problem;
 *   monitoring — fixed, not enough stays since to tell.
 */
export function resolutionState({ resolvedAt, eventsAfter, staysAfter, stays = 2 }) {
  if (!resolvedAt) return { state: "open_task", detail: "η εργασία συντήρησης δεν έχει ολοκληρωθεί" };
  if (eventsAfter > 0) return { state: "recurred", detail: `το ίδιο πρόβλημα αναφέρθηκε ξανά ${eventsAfter} φορ${eventsAfter === 1 ? "ά" : "ές"} μετά την επισκευή — η παρέμβαση δεν το έλυσε` };
  if (staysAfter >= stays) return { state: "effective", detail: `${staysAfter} διαμονές μετά την επισκευή χωρίς το πρόβλημα` };
  return { state: "monitoring", detail: `επισκευάστηκε · ${staysAfter}/${stays} διαμονές χωρίς το πρόβλημα μέχρι τώρα` };
}
