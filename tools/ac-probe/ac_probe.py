#!/usr/bin/env python3
"""
Corali — εντοπισμός κλιματιστικών στο δίκτυο του ξενοδοχείου (ΜΟΝΟ ΑΝΑΓΝΩΣΗ).

Τρέχει στο Raspberry Pi (ίδιο δίκτυο με τα κλιματιστικά). Δεν στέλνει ΚΑΜΙΑ εντολή στα κλιματιστικά:
  1. Tuya (Inventor Control, Smart Life): ακούει τις εκπομπές των συσκευών Tuya (UDP 6666/6667/7000) και καταγράφει
     device id, IP, έκδοση πρωτοκόλλου, product key. Δεν χρειάζεται κλειδί.
  2. Broadlink (AUX / AC Freedom): στέλνει το τυπικό μήνυμα ανακάλυψης Broadlink και καταγράφει όσες απαντούν
     (τύπος, IP, MAC). Αν ένα AUX δεν απαντά, ο τοπικός έλεγχος Broadlink πιθανότατα είναι κλειστός σε αυτό.
  3. Προαιρετικά, για ΜΙΑ συσκευή Tuya με γνωστό local key: διαβάζει την κατάσταση (DPs) — π.χ. ON/OFF,
     setpoint, λειτουργία, θερμοκρασία χώρου — χωρίς να αλλάζει τίποτα.

Χρήση:
  python3 ac_probe.py                       # εντοπισμός
  python3 ac_probe.py --tuya-id ID --tuya-ip IP --tuya-key KEY [--tuya-version 3.3]   # + ανάγνωση μίας συσκευής
Αποτέλεσμα: ac-probe-report.json (το local key ΔΕΝ γράφεται στο αρχείο).
"""
import argparse
import json
import socket
import sys
import time

def scan_tuya(seconds):
    try:
        import tinytuya
    except ImportError:
        return {"ok": False, "error": "λείπει η βιβλιοθήκη tinytuya (pip install tinytuya)"}
    try:
        found = tinytuya.deviceScan(verbose=False, maxretry=max(5, seconds), color=False) or {}
    except TypeError:
        found = tinytuya.deviceScan(False, max(5, seconds)) or {}
    except Exception as e:  # noqa: BLE001 — report, never crash the probe
        return {"ok": False, "error": f"σάρωση Tuya απέτυχε: {e}"}
    devices = []
    for ip, d in found.items():
        devices.append({
            "ip": d.get("ip", ip), "device_id": d.get("gwId") or d.get("id"), "version": d.get("version"),
            "product_key": d.get("productKey"), "name": d.get("name") or "", "encrypted": d.get("encrypt"),
        })
    return {"ok": True, "count": len(devices), "devices": devices}

def scan_broadlink(seconds):
    try:
        import broadlink
    except ImportError:
        return {"ok": False, "error": "λείπει η βιβλιοθήκη broadlink (pip install broadlink)"}
    try:
        found = broadlink.discover(timeout=seconds)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"ανακάλυψη Broadlink απέτυχε: {e}"}
    devices = []
    for d in found:
        devices.append({
            "ip": d.host[0], "mac": ":".join(f"{b:02x}" for b in d.mac), "devtype": hex(d.devtype),
            "model": getattr(d, "model", "") or "", "manufacturer": getattr(d, "manufacturer", "") or "",
            "name": getattr(d, "name", "") or "", "locked": bool(getattr(d, "is_locked", False)),
        })
    return {"ok": True, "count": len(devices), "devices": devices}

def read_tuya(dev_id, ip, key, version):
    try:
        import tinytuya
    except ImportError:
        return {"ok": False, "error": "λείπει η βιβλιοθήκη tinytuya"}
    try:
        d = tinytuya.Device(dev_id, ip, key, version=float(version))
        d.set_socketTimeout(5)
        status = d.status()  # read only
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"ανάγνωση απέτυχε: {e}"}
    if not isinstance(status, dict) or "dps" not in status:
        return {"ok": False, "error": f"απάντηση χωρίς DPs: {json.dumps(status)[:300]}"}
    return {"ok": True, "device_id": dev_id, "ip": ip, "version": version, "dps": status["dps"],
            "note": "Οι αριθμοί DP (π.χ. 1=ON/OFF, 2=setpoint, 3=θερμοκρασία χώρου, 4=λειτουργία) διαφέρουν ανά μοντέλο — θα αντιστοιχιστούν με δοκιμή."}

def main():
    ap = argparse.ArgumentParser(description="Εντοπισμός κλιματιστικών (μόνο ανάγνωση)")
    ap.add_argument("--seconds", type=int, default=12, help="διάρκεια σάρωσης (δευτερόλεπτα)")
    ap.add_argument("--tuya-id"); ap.add_argument("--tuya-ip"); ap.add_argument("--tuya-key"); ap.add_argument("--tuya-version", default="3.3")
    ap.add_argument("--out", default="ac-probe-report.json")
    a = ap.parse_args()
    report = {
        "tool": "corali-ac-probe", "version": 1, "at": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "host": socket.gethostname(),
        "read_only": True, "tuya": scan_tuya(a.seconds), "broadlink": scan_broadlink(min(a.seconds, 10)),
    }
    if a.tuya_id and a.tuya_ip and a.tuya_key:
        report["tuya_read"] = read_tuya(a.tuya_id, a.tuya_ip, a.tuya_key, a.tuya_version)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    t, b = report["tuya"], report["broadlink"]
    print(f"Tuya: {t.get('count', 0) if t['ok'] else 'σφάλμα — ' + t['error']}")
    for d in t.get("devices", []): print(f"  {d['ip']:15}  id={d['device_id']}  v{d['version']}  product={d['product_key']}")
    print(f"Broadlink: {b.get('count', 0) if b['ok'] else 'σφάλμα — ' + b['error']}")
    for d in b.get("devices", []): print(f"  {d['ip']:15}  {d['devtype']}  {d['mac']}  {d['model']} {d['manufacturer']}{'  (κλειδωμένο)' if d['locked'] else ''}")
    if "tuya_read" in report:
        r = report["tuya_read"]; print("Ανάγνωση Tuya:", json.dumps(r.get("dps") if r["ok"] else r["error"], ensure_ascii=False))
    print(f"Αναφορά: {a.out} (στείλτε τη — δεν περιέχει κλειδιά)")
    return 0

if __name__ == "__main__":
    sys.exit(main())
