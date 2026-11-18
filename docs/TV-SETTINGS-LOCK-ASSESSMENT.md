# Lock / Unlock TV Settings — τεχνική αξιολόγηση (HORIZON 43HQ8590U/D, Corali TV 1.13)

**Απάντηση σήμερα: όχι ακόμα.** Δεν υπάρχει αποδεδειγμένος ασφαλής μηχανισμός για να κλειδώσει / ξεκλειδώσει το PMS το «Lock Menu Key». Δεν προστέθηκε κουμπί Lock/Unlock στο PMS, για να μην εμφανίζεται λειτουργία που δεν δουλεύει. Η ένδειξη μένει `OEM_BRIDGE_REQUIRED` / `UNSUPPORTED`.

## 1. Τι ξέρουμε
- Το Lock Menu Key αλλάζει από την εφαρμογή `com.expressluck.tvfactory`, που τρέχει ως **system (UID 1000)**.
- Το `settings get global hotel_menu_key_lock` έδειξε `0` ενώ το μενού έδειχνε `On` → η πραγματική τιμή **δεν** αποθηκεύεται εκεί (ή όχι μόνο εκεί).
- Η μέθοδος `HotelModelManager.setLockMenuKey(int)` αναφέρθηκε από προηγούμενη ανάλυση, **χωρίς** να έχει επιβεβαιωθεί πού γράφει, ποια άδεια θέλει, και αν υπάρχει εξωτερική διεπαφή (exported receiver / provider / service / AIDL). Το APK δεν έχει αναλυθεί εδώ.

## 2. Τι μπορεί ο Agent
| Τρόπος | Ταυτότητα | Μπορεί; |
|---|---|---|
| Corali TV (εφαρμογή) | UID 10075, χωρίς system/signature άδειες | **Όχι** να καλέσει εσωτερικό system API ή να γράψει system/vendor ιδιότητες |
| Self-ADB της εφαρμογής (1.11+) | shell (UID 2000) | Μπορεί να γράψει `settings` (global/secure/system) και να ανοίξει activities. **Δεν** μπορεί να γράψει `persist.vendor.*`/system ιδιότητες ούτε να καλέσει υπηρεσίες που ελέγχουν για UID 1000. Εξαρτάται από το ADB (απαίτηση: όχι ADB ως προϋπόθεση) |
| Device Owner | — | Δεν εγκαθίσταται χωρίς ξεχωριστή έγκριση (και δεν κλειδώνει το εργοστασιακό Lock Menu Key· έχει δικούς του περιορισμούς Android) |

## 3. Τι χρειάζεται για να απαντηθεί οριστικά (μόνο ανάγνωση, χωρίς κίνδυνο)
1. **Το APK** `TvEplFactoryGTV.apk` εδώ στη συνομιλία (ή: `adb shell pm path com.expressluck.tvfactory` → `adb pull <διαδρομή> factory.apk`). Ανάλυση: τι κάνει πραγματικά το `setLockMenuKey`, πού γράφει, εξαγόμενα components, άδειες.
2. **Πού αποθηκεύεται** η τιμή — με την TV ανοιχτή, πριν και μετά την αλλαγή On/Off από το Factory Menu:
   ```
   adb shell getprop > lock-off-props.txt
   adb shell settings list global > lock-off-global.txt
   adb shell settings list secure > lock-off-secure.txt
   adb shell settings list system > lock-off-system.txt
   ```
   (μετά Lock Menu Key = On και τα ίδια με `lock-on-…`). Στείλτε τα 8 αρχεία· η διαφορά δείχνει πού αποθηκεύεται.
3. `adb shell dumpsys package com.expressluck.tvfactory > factory-package.txt` (εξαγόμενα components και άδειες).

## 4. Πιθανά αποτελέσματα και τι σημαίνουν
| Εύρημα | Συνέπεια |
|---|---|
| Η τιμή είναι κλειδί `settings` | Το Self-ADB θα μπορούσε να το γράψει. Πρέπει να αποδειχθεί ότι **κλειδώνει πραγματικά** (όχι μόνο αλλάζει τιμή) και ότι επιβιώνει επανεκκίνησης. Εξαρτάται από το ADB |
| Ιδιότητα `persist.vendor`/system ή αρχείο/βάση της εφαρμογής | Μόνο system: **όχι** από τον Agent. Λύση: επίσημη διεπαφή Expressluck/Realtek (π.χ. εξαγόμενη υπηρεσία με άδεια για εγκεκριμένο πιστοποιητικό) |
| Εξαγόμενο component χωρίς άδεια | Τεχνικά εφικτό, αλλά **κενό ασφαλείας** του κατασκευαστή: δεν το χρησιμοποιούμε χωρίς έγκρισή του |

## 5. Εναλλακτικές μέχρι τότε
- Χειροκίνητο Lock Menu Key από τεχνικό (όπως σήμερα), καταγεγραμμένο στο PMS ως «χειροκίνητο, μη επιβεβαιωμένο από PMS».
- Αίτημα στην Expressluck/Realtek για υποστηριζόμενη διεπαφή (Hotel Mode API / MDM).
- Device Owner μόνο μετά από ξεχωριστή αξιολόγηση (απαιτεί πλήρη επαναφορά TV ή αφαίρεση λογαριασμών, δεν είναι το ίδιο με το εργοστασιακό κλείδωμα).

Η υλοποίηση στο PMS (LOCKED / UNLOCKED / PENDING / FAILED / UNKNOWN / UNSUPPORTED, επιβεβαίωση από την TV, timeout, audit, ανάκτηση) θα γίνει **μόνο** αφού αποδειχθεί μηχανισμός στη 112.
