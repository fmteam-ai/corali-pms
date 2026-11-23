# Corali Watchdog στο Fly.io — εξωτερική παρακολούθηση

Τρέχει **έξω** από τη φιλοξενία του ξενοδοχείου. Αν πέσει ο server, η βάση, το cron ή το email του PMS, ο watchdog
εξακολουθεί να ελέγχει και να ειδοποιεί (Telegram / ntfy / webhook — κανένα δεν περνά από το PMS).

## Τι ελέγχει κάθε λεπτό

| Έλεγχος | Πότε ειδοποιεί |
|---|---|
| `pms`, `booking` | `/api/health` δεν απαντά 200 / `ok:true` σε 10″ (3 συνεχόμενες φορές) |
| `heartbeat` | `/api/monitoring/heartbeat` απρόσιτο, **υπογραφή άκυρη** ή παλιά (> 5′ — δεν γίνεται replay) |
| `database`, `cron`, `sentinel` | οτιδήποτε άλλο εκτός από ακριβώς `ok`: `fail`, `unknown`, λείπει → 🔴 κρίσιμο (3 έλεγχοι)· `warn` → 🟠 προειδοποίηση (9 έλεγχοι) |
| `component:*` | κάθε άλλο component του PMS (ουρά OTA, ειδοποιήσεις, backups, social…) με τους ίδιους κανόνες |
| `state_storage` | ο watchdog δεν μπορεί να αποθηκεύσει την κατάστασή του στο volume |
| `sentinel_progress`, `cron_progress` | οι μετρητές εκτελέσεων **δεν αυξάνονται** για 20′ (κολλημένη εργασία ακόμη κι αν «λέει ok») |

Μία ειδοποίηση ανά πρόβλημα (🔴 κρίσιμο / 🟠 προειδοποίηση), υπενθύμιση κάθε 60′ (προειδοποιήσεις κάθε 6 ώρες),
κλιμάκωση όταν μια προειδοποίηση γίνει κρίσιμη, ειδοποίηση αποκατάστασης μετά από 2 επιτυχημένους ελέγχους. Heartbeat
με άκυρο JSON ή χωρίς τα απαραίτητα πεδία = `HEARTBEAT_INVALID`. Ειδοποίηση που δεν παραδόθηκε (3 προσπάθειες)
ξαναδοκιμάζεται στον επόμενο κύκλο και **μένει στο volume**: δεν χάνεται σε επανεκκίνηση. Ο watchdog δεν γράφει τίποτα στο PMS.

## 1. Στο PMS (μία φορά)

Στο `runtime.env` **και των δύο** εφαρμογών (PMS και Booking) προσθέστε το ίδιο μυστικό (τουλάχιστον 32 χαρακτήρες):

```bash
MONITORING_SECRET=<τυχαία τιμή, π.χ. από: openssl rand -hex 32>
```

και επανεκκινήστε τις εφαρμογές. Χωρίς αυτό το `/api/monitoring/heartbeat` απαντά 503 (δεν σερβίρεται ποτέ ανυπόγραφο).

Προσθέστε επίσης το cron του Sentinel (κάθε 5 λεπτά) στο cPanel:

```bash
cd /home/corali/apps/corali-pms && /usr/bin/node --env-file=runtime.env scripts/run-sentinel.mjs
```

## 2. Στο Fly.io

```bash
fly auth login
fly apps create corali-watchdog-<κάτι-μοναδικό>      # και το ίδιο όνομα στη γραμμή app του fly.toml
fly volumes create watchdog_data --region fra --size 1
fly secrets set --stage MONITORING_SECRET=<η ίδια τιμή> NTFY_URL=https://ntfy.sh/<μακρύ-τυχαίο-θέμα>
fly deploy --ha=false
fly logs
```

Στα logs εμφανίζεται μία γραμμή `watchdog_cycle` το λεπτό. Δοκιμή: διακόψτε προσωρινά το cron του Sentinel → σε ~20′
έρχεται «sentinel_progress»· επαναφέρετέ το → έρχεται «αποκαταστάθηκε».

## Κόστος και έλεγχος κόστους

- Ένα μηχάνημα `shared-cpu-1x` με 256 MB και volume 1 GB, χωρίς δημόσια υπηρεσία: σχεδόν η χαμηλότερη βαθμίδα του Fly.io
  (λίγα δολάρια τον μήνα — επιβεβαιώστε στην τρέχουσα τιμολόγηση: https://fly.io/docs/about/pricing/).
- `fly scale count 1` — ποτέ περισσότερα μηχανήματα· χωρίς `[http_service]`, άρα χωρίς κίνηση εισόδου.
- Αν δεν χρειάζεται, αποδεσμεύστε δημόσια IP: `fly ips list` και `fly ips release <ip>`.
- Ορίστε όριο / ειδοποίηση χρέωσης στον λογαριασμό του Fly.io (Billing).
- Το volume (`watchdog_data`, 1 GB) κρατά τα ανοιχτά προβλήματα, τους μετρητές και τις ειδοποιήσεις που δεν έχουν
  παραδοθεί. Δημιουργείται μία φορά, **πριν** από το `fly deploy`:
  `fly volumes create watchdog_data --region fra --size 1`

## Ποιος παρακολουθεί τον watchdog

Ορίστε `DEADMAN_URL` (π.χ. δωρεάν healthchecks.io): ο watchdog το «χτυπά» κάθε λεπτό· αν σταματήσει, σας ειδοποιεί
η υπηρεσία αυτή.

## Δοκιμή χωρίς Fly.io

```bash
PMS_HEALTH_URL=https://pms.hotelcorali.gr/api/health PMS_HEARTBEAT_URL=https://pms.hotelcorali.gr/api/monitoring/heartbeat \
MONITORING_SECRET=... NTFY_URL=https://ntfy.sh/... node watchdog.mjs
```

## Αναβάθμιση από τον watchdog της v201 (χωρίς volume)

Από τον φάκελο του νέου πακέτου, με το ίδιο όνομα εφαρμογής στο `fly.toml`:

```bash
fly volumes create watchdog_data --region fra --size 1
fly deploy --ha=false
```

Συνήθως το Fly αντικαθιστά μόνο του το παλιό μηχάνημα με νέο που έχει το volume (μήνυμα «Failed to clear lease … lease
not found» για το παλιό = αναμενόμενο). Ελέγξτε με `fly machine list`: ένα μηχάνημα, στήλη VOLUME συμπληρωμένη. Μόνο αν
μείνει μηχάνημα χωρίς volume, διαγράψτε το (τα μυστικά μένουν) και ξανατρέξτε το deploy:

```bash
fly machine list
fly machine destroy <id> --force
fly deploy --ha=false
```

## Αποδοχή μιας ειδοποίησης (v203)

Μια ειδοποίηση φεύγει από την ουρά μόνο όταν ο πάροχος την **αποδεχθεί**: Telegram → HTTP 2xx **και** `{"ok":true}`,
ntfy → HTTP 2xx **και** id μηνύματος, webhook → HTTP 2xx. Διαφορετικά μένει στην ουρά (και μετά από επανεκκίνηση) με το
σφάλμα του παρόχου και ξαναστέλνεται μόνο σε όποιον δεν την αποδέχθηκε.

## Πραγματική δοκιμή στο Fly.io (προτείνεται μία φορά)

Τα τοπικά tests δεν αποδεικνύουν ότι η ειδοποίηση φτάνει στο κινητό. Δοκιμή χωρίς να πειράξετε το PMS: ένα λάθος
κλειδί στο Fly κάνει το heartbeat «υπογραφή invalid» (κρίσιμο).

1. `fly secrets set MONITORING_SECRET=lathos-kleidi-dokimis-0000000000000000000000 -a <app>` → μετά από ~3′ πρέπει να
   έρθει στο κινητό **μία** ειδοποίηση 🔴 «heartbeat».
2. Με το incident ανοιχτό: `fly machine restart <id> -a <app>` → μετά την επανεκκίνηση **δεν** πρέπει να ξανάρθει η ίδια
   αρχική ειδοποίηση (η κατάσταση διαβάζεται από το `/data/state.json`). Στα logs: `"open":["heartbeat"]`.
3. Βάλτε ξανά το σωστό κλειδί (όπως στην εγκατάσταση) → μετά από 2 επιτυχημένους ελέγχους έρχεται **μία** ειδοποίηση ✅
   «αποκαταστάθηκε».

Σημείωση για εντολές ελέγχου από τον server: το ModSecurity του hosting απορρίπτει με HTTP 406 αιτήματα με User-Agent
`curl`. Χρησιμοποιήστε `curl -A node …` (ο watchdog στέλνει `node` και δεν επηρεάζεται).
