# Εντοπισμός κλιματιστικών — Raspberry Pi (μόνο ανάγνωση)

Το εργαλείο **δεν στέλνει εντολές** στα κλιματιστικά. Βρίσκει ποια απαντούν στο τοπικό δίκτυο και με ποιο πρωτόκολλο,
ώστε η σύνδεση με το PMS να βασιστεί σε πραγματικά δεδομένα.

## Εγκατάσταση (μία φορά, στο Raspberry Pi της γέφυρας Omada)

```bash
sudo apt-get install -y python3-venv
python3 -m venv ~/ac-probe && ~/ac-probe/bin/pip install tinytuya broadlink
```

## Εκτέλεση

Τα κλιματιστικά να είναι ρευματοδοτημένα και συνδεδεμένα στο Wi-Fi (στις εφαρμογές τους), στο ίδιο δίκτυο με το Pi.

```bash
~/ac-probe/bin/python ac_probe.py
```

Στείλτε το `ac-probe-report.json`. Δεν περιέχει κωδικούς ή κλειδιά.

## Τι περιμένουμε

- **Inventor (EU-ODZ104, εφαρμογή Inventor Control):** αν είναι Tuya, εμφανίζονται στη λίστα «Tuya» με device id και έκδοση
  πρωτοκόλλου. Για τον έλεγχο χρειάζεται επιπλέον το *local key* κάθε μονάδας.
- **AUX (CTTG-40X24-WIFI-AKS2 / BL3353-P, AC Freedom):** αν εμφανιστούν στη λίστα «Broadlink», ο τοπικός έλεγχος είναι εφικτός.
  Αν δεν εμφανιστούν, το module δεν απαντά στο πρωτόκολλο Broadlink.

## Ανάγνωση μίας μονάδας Tuya (όταν υπάρχει local key)

```bash
~/ac-probe/bin/python ac_probe.py --tuya-id DEVICE_ID --tuya-ip 192.168.x.y --tuya-key LOCAL_KEY --tuya-version 3.3
```

Μόνο ανάγνωση κατάστασης (ON/OFF, setpoint, λειτουργία, θερμοκρασία). Το κλειδί δεν αποθηκεύεται στην αναφορά.
