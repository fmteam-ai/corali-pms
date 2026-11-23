#!/usr/bin/env python3
"""
Corali AC Probe v2 — διάγνωση κλιματιστικών στο δίκτυο του ξενοδοχείου (ΜΟΝΟ ΑΝΑΓΝΩΣΗ, ΧΩΡΙΣ ΠΡΟΣΘΕΤΟ HARDWARE).

Χρησιμοποιεί αποκλειστικά τα εργοστασιακά Wi-Fi modules των κλιματιστικών. Τρέχει σε υπολογιστή / Raspberry Pi που ήδη
υπάρχει στο ίδιο δίκτυο. ΔΕΝ στέλνει καμία εντολή λειτουργίας (ON/OFF, θερμοκρασία, λειτουργία) σε κλιματιστικό.

Τι κάνει:
  1. Πίνακας γειτόνων (ARP / ip neigh): IP + MAC, και κατασκευαστής του Wi-Fi module από το πρόθεμα MAC (OUI).
     Καταγράφονται ΜΟΝΟ συσκευές με πρόθεμα γνωστού κατασκευαστή IoT module ή που απάντησαν σε ανακάλυψη — κινητά /
     υπολογιστές πελατών ΔΕΝ καταγράφονται (μόνο ο αριθμός τους).
  2. Tuya (Inventor Control / Smart Life): ακούει τις εκπομπές (UDP 6666/6667/7000) — device id, IP, έκδοση πρωτοκόλλου.
  3. BroadLink (AUX / AC Freedom): το τυπικό μήνυμα ανακάλυψης — τύπος, IP, MAC, «κλειδωμένο» ή όχι.
  4. Θύρες: μόνο σύνδεση TCP και αμέσως κλείσιμο (χωρίς δεδομένα) στις 6668 (Tuya local), 80 (HTTP του module).
  5. Κατάταξη ανά συσκευή: LOCAL_API (ελέγξιμο τοπικά), LOCAL_API_NEEDS_KEY (Tuya: χρειάζεται local key),
     LOCAL_LOCKED (BroadLink κλειδωμένο → μόνο cloud), CLOUD_ONLY_OR_UNKNOWN (δεν απαντά τοπικά).
  6. Προαιρετικά, ανάγνωση θερμοκρασίας χώρου / setpoint ΜΟΝΟ όπου το module το επιτρέπει:
       Tuya με local key (--tuya-id/--tuya-ip/--tuya-key) → status() μόνο ανάγνωση.
       BroadLink: μόνο έλεγχος αν δέχεται τοπική σύνδεση (auth) με --broadlink-auth — η ανάγνωση κατάστασης AUX
       απαιτεί το ειδικό πρωτόκολλο AUX και θα προστεθεί μόνο αφού επιβεβαιωθεί ότι το module δέχεται τοπική σύνδεση.
Εξαγωγή: ac-probe-report.json χωρίς κωδικούς, κλειδιά, όνομα δικτύου, όνομα υπολογιστή ή στοιχεία πελατών.
"""
import argparse
import hashlib
import json
import os
import re
import socket
import subprocess
import sys
import time

REPORT_VERSION = 2

# Προθέματα MAC (OUI) κατασκευαστών Wi-Fi modules κλιματιστικών / IoT. Ενδεικτικά: ο κατασκευαστής του MODULE, όχι
# απαραίτητα του κλιματιστικού. Ό,τι δεν είναι στη λίστα δεν καταγράφεται (προστασία στοιχείων πελατών).
OUI = {
    "34:ea:34": "Hangzhou BroadLink", "78:0f:77": "Hangzhou BroadLink", "b4:43:0d": "Hangzhou BroadLink",
    "c8:f7:42": "Hangzhou BroadLink", "24:df:a7": "Hangzhou BroadLink", "ec:0b:ae": "Hangzhou BroadLink",
    "10:d5:61": "Tuya Smart", "68:57:2d": "Tuya Smart", "84:e3:42": "Tuya Smart", "d4:a6:51": "Tuya Smart",
    "a0:92:08": "Tuya Smart", "7c:f6:66": "Tuya Smart", "18:69:d8": "Tuya Smart", "50:8a:06": "Tuya Smart",
    "fc:67:1f": "Tuya Smart", "38:1f:8d": "Tuya Smart", "cc:8c:bf": "Tuya Smart",
    "24:0a:c4": "Espressif", "30:ae:a4": "Espressif", "84:f3:eb": "Espressif", "a4:cf:12": "Espressif",
    "bc:dd:c2": "Espressif", "cc:50:e3": "Espressif", "ec:fa:bc": "Espressif", "3c:71:bf": "Espressif",
    "24:62:ab": "Espressif", "10:52:1c": "Espressif", "68:c6:3a": "Espressif", "d8:bf:c0": "Espressif",
    "48:3f:da": "Espressif", "c4:4f:33": "Espressif", "7c:9e:bd": "Espressif", "ac:cf:23": "Hi-Flying",
    "98:d8:63": "Hi-Flying", "f0:fe:6b": "Hi-Flying",
}
MAC_RE = re.compile(r"(?:[0-9a-f]{2}:){5}[0-9a-f]{2}", re.I)
IP_RE = re.compile(r"^\d{1,3}(?:\.\d{1,3}){3}$")


def vendor(mac):
    return OUI.get(str(mac or "").lower()[:8]) if mac else None


def read_neighbors(neigh_file=None):
    """IP → MAC from the kernel's neighbour table (no packets sent). Returns (entries, error)."""
    text = ""
    try:
        if neigh_file:
            with open(neigh_file, encoding="utf-8") as f:
                text = f.read()
        else:
            try:
                text = subprocess.run(["ip", "neigh", "show"], capture_output=True, text=True, timeout=5).stdout
            except (OSError, subprocess.SubprocessError):
                with open("/proc/net/arp", encoding="utf-8") as f:
                    text = f.read()
    except OSError as e:
        return [], f"ο πίνακας γειτόνων δεν διαβάστηκε: {e}"
    out = {}
    for line in text.splitlines():
        parts = line.split()
        ip = next((p for p in parts if IP_RE.match(p)), None)
        mac = next((m.group(0).lower() for m in [MAC_RE.search(line)] if m), None)
        if ip and mac and mac != "00:00:00:00:00:00":
            out[ip] = mac
    return [{"ip": ip, "mac": mac} for ip, mac in sorted(out.items())], None


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
            "ip": d.get("ip", ip), "device_id": d.get("gwId") or d.get("id"), "version": str(d.get("version") or ""),
            "product_key": d.get("productKey"), "encrypted": d.get("encrypt"),
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
        return {"ok": False, "error": f"ανακάλυψη BroadLink απέτυχε: {e}"}
    devices = []
    for d in found:
        devices.append({
            "ip": d.host[0], "mac": ":".join(f"{b:02x}" for b in d.mac), "devtype": hex(d.devtype),
            "model": getattr(d, "model", "") or "", "manufacturer": getattr(d, "manufacturer", "") or "",
            "locked": bool(getattr(d, "is_locked", False)), "_dev": d,
        })
    return {"ok": True, "count": len(devices), "devices": devices}


def tcp_open(ip, port, timeout=1.5):
    """Connect and close immediately — no data is sent."""
    try:
        with socket.create_connection((ip, port), timeout=timeout):
            return True
    except OSError:
        return False


def broadlink_auth(dev):
    """Only checks that the module accepts a local session (auth). No state read, no command."""
    try:
        return {"ok": bool(dev.auth()), "detail": "το module δέχεται τοπική σύνδεση"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "detail": f"τοπική σύνδεση απορρίφθηκε: {str(e)[:120]}"}


# Common Tuya A/C data points. They differ between models — reported as candidates, confirmed later by observation.
TUYA_DP_HINTS = {"1": "power", "2": "setpoint", "3": "room_temperature", "4": "mode", "5": "fan_speed"}


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
    dps = {str(k): v for k, v in status["dps"].items()}
    guess = {}
    for k, name in TUYA_DP_HINTS.items():
        if k in dps:
            guess[name] = dps[k]
    return {"ok": True, "device_id": dev_id, "ip": ip, "version": str(version), "dps": dps, "candidates": guess,
            "note": "Οι αριθμοί DP διαφέρουν ανά μοντέλο — οι «candidates» επιβεβαιώνονται συγκρίνοντας με την οθόνη / το τηλεχειριστήριο."}


def classify(dev):
    """LOCAL_API | LOCAL_API_NEEDS_KEY | LOCAL_LOCKED | CLOUD_ONLY_OR_UNKNOWN, with the reason."""
    if dev.get("broadlink"):
        if dev["broadlink"]["locked"]:
            return "LOCAL_LOCKED", "BroadLink: το module είναι κλειδωμένο για τοπική χρήση — έλεγχος μόνο μέσω cloud (AC Freedom)"
        auth = dev.get("broadlink_auth")
        if auth and not auth["ok"]:
            return "LOCAL_LOCKED", f"BroadLink: {auth['detail']}"
        return "LOCAL_API", "BroadLink: απαντά στην τοπική ανακάλυψη" + (" και δέχεται τοπική σύνδεση" if auth else "")
    if dev.get("tuya"):
        v = dev["tuya"]["version"]
        if dev.get("tuya_read", {}).get("ok"):
            return "LOCAL_API", f"Tuya v{v}: η κατάσταση διαβάστηκε τοπικά"
        return "LOCAL_API_NEEDS_KEY", f"Tuya v{v}: τοπικό API διαθέσιμο, χρειάζεται το local key της μονάδας"
    if dev.get("ports", {}).get("6668"):
        return "LOCAL_API_NEEDS_KEY", "ανοιχτή θύρα 6668 (Tuya local) χωρίς εκπομπή — πιθανώς Tuya, χρειάζεται local key"
    return "CLOUD_ONLY_OR_UNKNOWN", "δεν απαντά σε τοπικό πρωτόκολλο που γνωρίζουμε — πιθανώς μόνο cloud"


def build_report(a, neighbors, neigh_error, tuya, bl, now=None):
    devices = {}
    for n in neighbors:
        if vendor(n["mac"]):
            devices[n["ip"]] = {"ip": n["ip"], "mac": n["mac"]}
    for t in tuya.get("devices", []):
        devices.setdefault(t["ip"], {"ip": t["ip"]})["tuya"] = {k: t.get(k) for k in ("device_id", "version", "product_key", "encrypted")}
    for b in bl.get("devices", []):
        d = devices.setdefault(b["ip"], {"ip": b["ip"]})
        d["mac"] = b["mac"]
        d["broadlink"] = {k: b[k] for k in ("devtype", "model", "manufacturer", "locked")}
        if a.broadlink_auth and not b["locked"]:
            d["broadlink_auth"] = broadlink_auth(b["_dev"])
    macs = {n["ip"]: n["mac"] for n in neighbors}
    for ip, d in devices.items():
        d.setdefault("mac", macs.get(ip))
        d["module_vendor"] = vendor(d.get("mac")) or ("Tuya (από εκπομπή)" if d.get("tuya") else "BroadLink (από ανακάλυψη)" if d.get("broadlink") else None)
        if not a.no_port_check:
            d["ports"] = {"6668": tcp_open(ip, 6668), "80": tcp_open(ip, 80)}
        if a.tuya_id and a.tuya_ip == ip and a.tuya_key:
            d["tuya_read"] = read_tuya(a.tuya_id, a.tuya_ip, a.tuya_key, a.tuya_version)
        d["access"], d["access_reason"] = classify(d)
    listed = sorted(devices.values(), key=lambda x: tuple(int(p) for p in x["ip"].split(".")))
    summary = {}
    for d in listed:
        summary[d["access"]] = summary.get(d["access"], 0) + 1
    return {
        "tool": "corali-ac-probe", "version": REPORT_VERSION, "at": now or time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        # A one-way fingerprint only, so several reports from the same probe can be told apart — not the host name.
        "probe_id": hashlib.sha256(socket.gethostname().encode()).hexdigest()[:10],
        "read_only": True, "extra_hardware": False,
        "neighbors": {"ok": neigh_error is None, "error": neigh_error, "total": len(neighbors),
                      "iot_listed": sum(1 for n in neighbors if vendor(n["mac"])),
                      "not_listed": sum(1 for n in neighbors if not vendor(n["mac"]) and n["ip"] not in devices)},
        "tuya": {k: v for k, v in tuya.items() if k != "devices"},
        "broadlink": {k: v for k, v in bl.items() if k != "devices"},
        "devices": listed, "summary": summary,
        "privacy": "χωρίς κωδικούς, local keys, όνομα δικτύου, όνομα υπολογιστή ή συσκευές πελατών",
    }


def redaction_check(report, secrets):
    """Fails loudly if a secret would end up in the exported file."""
    text = json.dumps(report, ensure_ascii=False)
    for s in secrets:
        if s and len(s) >= 6 and s in text:
            raise RuntimeError("ένα μυστικό θα γραφόταν στην αναφορά — ακυρώθηκε")
    return text


def main(argv=None):
    ap = argparse.ArgumentParser(description="Διάγνωση κλιματιστικών (μόνο ανάγνωση, χωρίς πρόσθετο hardware)")
    ap.add_argument("--seconds", type=int, default=12, help="διάρκεια σάρωσης (δευτερόλεπτα)")
    ap.add_argument("--tuya-id"); ap.add_argument("--tuya-ip"); ap.add_argument("--tuya-key"); ap.add_argument("--tuya-version", default="3.3")
    ap.add_argument("--broadlink-auth", action="store_true", help="έλεγχος αν το BroadLink module δέχεται τοπική σύνδεση (χωρίς εντολή)")
    ap.add_argument("--no-port-check", action="store_true", help="χωρίς έλεγχο θυρών TCP")
    ap.add_argument("--neigh-file", help=argparse.SUPPRESS)
    ap.add_argument("--out", default="ac-probe-report.json")
    a = ap.parse_args(argv)
    if a.tuya_key is None and os.environ.get("CORALI_TUYA_KEY"):
        a.tuya_key = os.environ["CORALI_TUYA_KEY"]
    neighbors, neigh_error = read_neighbors(a.neigh_file)
    tuya, bl = scan_tuya(a.seconds), scan_broadlink(min(a.seconds, 10))
    report = build_report(a, neighbors, neigh_error, tuya, bl)
    redaction_check(report, [a.tuya_key])
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"Συσκευές IoT που βρέθηκαν: {len(report['devices'])} (άλλες συσκευές στο δίκτυο, χωρίς καταγραφή: {report['neighbors']['not_listed']})")
    for d in report["devices"]:
        print(f"  {d['ip']:15} {d.get('mac') or '—':17} {d.get('module_vendor') or '—':22} {d['access']:22} {d['access_reason']}")
        r = d.get("tuya_read")
        if r:
            print("     ανάγνωση:", json.dumps(r.get("candidates") if r["ok"] else r["error"], ensure_ascii=False))
    if not tuya["ok"]:
        print("Tuya:", tuya["error"])
    if not bl["ok"]:
        print("BroadLink:", bl["error"])
    print(f"Αναφορά: {a.out} — δεν περιέχει κλειδιά ή στοιχεία πελατών.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
