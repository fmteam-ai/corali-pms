#!/usr/bin/env python3
"""Corali PMS ↔ TP-Link Omada bridge (v179), for a Raspberry Pi inside the hotel network.

The OC200's Open API is only reachable inside the hotel. Every minute this program asks the PMS what to do
(GET {pms}/api/bridge/omada with its token), adds / removes the guests' Wi-Fi passwords (PPSK) on the controller and
reports back (POST). It keeps no state of its own; the PMS decides everything. Python 3 standard library only.

Config: /etc/corali-bridge.json  {"pms": "https://pms.example", "token": "cb_..."}
"""
import ipaddress
import json
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

CONFIG = "/etc/corali-bridge.json"
EVERY = 60  # seconds between two rounds
VERSION = "1"


def log(msg):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), msg, flush=True)


def private_host(url):
    host = urllib.parse.urlparse(url).hostname or ""
    try:
        return ipaddress.ip_address(host).is_private
    except ValueError:
        return host.endswith(".local")


def http(method, url, body=None, headers=None, insecure=False, timeout=20):
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json", **(headers or {})})
    # The controller inside the hotel has a self-signed certificate: accepted only for a private address.
    ctx = ssl._create_unverified_context() if insecure else ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as r:
            return r.status, json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "null")
        except Exception:
            return e.code, None


class OmadaError(Exception):
    pass


class Omada:
    def __init__(self, c):
        self.c = c
        self.base = c["url"].rstrip("/")
        if not self.base.startswith("https://"):
            self.base = "https://" + self.base.split("://")[-1]
        self.insecure = private_host(self.base)
        self.token = None

    def _call(self, method, path, body=None, auth=True):
        headers = {"Authorization": "AccessToken=" + self.token} if auth else {}
        try:
            status, data = http(method, self.base + path, body, headers, self.insecure)
        except Exception:
            raise OmadaError("OMADA_UNREACHABLE")
        if status in (401, 403):
            raise OmadaError("OMADA_AUTH")
        if status != 200 or not isinstance(data, dict):
            raise OmadaError("OMADA_HTTP_%s" % status)
        if data.get("errorCode") != 0:
            raise OmadaError("OMADA_ERROR_%s" % data.get("errorCode"))
        return data.get("result")

    def login(self):
        r = self._call("POST", "/openapi/authorize/token?grant_type=client_credentials",
                       {"omadacId": self.c["omadacId"], "client_id": self.c["clientId"], "client_secret": self.c["clientSecret"]}, auth=False)
        if not r or not r.get("accessToken"):
            raise OmadaError("OMADA_AUTH")
        self.token = r["accessToken"]

    def api(self, method, path, body=None):
        if not self.token:
            self.login()
        try:
            return self._call(method, "/openapi/v1/%s%s" % (self.c["omadacId"], path), body)
        except OmadaError as e:
            if str(e) != "OMADA_AUTH":
                raise
            self.login()  # the access token expired: sign in again once
            return self._call(method, "/openapi/v1/%s%s" % (self.c["omadacId"], path), body)

    def site_id(self):
        r = self.api("GET", "/sites?page=1&pageSize=100") or {}
        sites = r.get("data") or []
        name = (self.c.get("siteName") or "").strip().lower()
        for s in sites:
            if name and str(s.get("name", "")).strip().lower() == name:
                return s["siteId"]
        if not name and len(sites) == 1:
            return sites[0]["siteId"]
        raise OmadaError("OMADA_SITE_NOT_FOUND")

    def profile_id(self, site):
        want = (self.c.get("profile") or "").strip().lower()
        for p in self.api("GET", "/sites/%s/ppsk-profiles" % site) or []:
            if str(p.get("profileName", "")).strip().lower() == want:
                return p["id"]
        raise OmadaError("OMADA_PROFILE_NOT_FOUND")

    def names(self, site, profile):
        r = self.api("GET", "/sites/%s/ppsk-profile/%s" % (site, profile)) or {}
        return [str(x.get("name")) for x in (r.get("ppsk") or [])]

    def add(self, site, profile, name, psk):
        self.api("POST", "/sites/%s/ppsk-profile/%s/add-psk" % (site, profile), {"ppskList": [{"name": name, "psk": psk}]})

    def delete(self, site, profile, names):
        self.api("POST", "/sites/%s/ppsk-profile/%s/delete-psk" % (site, profile), {"ppskNameList": names})


def one_round(cfg, omada_cache):
    pms, auth = cfg["pms"].rstrip("/"), {"Authorization": "Bearer " + cfg["token"], "User-Agent": "corali-bridge/" + VERSION}
    status, plan = http("GET", pms + "/api/bridge/omada", headers=auth)
    if status != 200 or not isinstance(plan, dict) or not plan.get("ok"):
        log("PMS answered %s — check the token / the PMS address" % status)
        return
    if not plan.get("omada"):
        return  # Omada not active in PMS → Integrations
    key = json.dumps(plan["omada"], sort_keys=True)
    if omada_cache.get("key") != key:
        omada_cache.clear()
        omada_cache.update(key=key, client=Omada(plan["omada"]))
    om = omada_cache["client"]
    results, check = [], "OK"
    try:
        site = om.site_id()
        profile = om.profile_id(site)
        existing = om.names(site, profile) if plan.get("add") else []
        for a in plan.get("add", []):
            try:
                if a["name"] in existing:
                    om.delete(site, profile, [a["name"]])  # a retry: replace with the PMS's password
                om.add(site, profile, a["name"], a["psk"])
                results.append({"bookingId": a["bookingId"], "op": "add", "ok": True})
                log("added %s" % a["name"])
            except OmadaError as e:
                results.append({"bookingId": a["bookingId"], "op": "add", "ok": False, "error": str(e)})
        removes = plan.get("remove", [])
        if removes:
            try:
                om.delete(site, profile, [r["name"] for r in removes])
                results += [{"bookingId": r["bookingId"], "op": "remove", "ok": True} for r in removes]
                log("removed %s" % ", ".join(r["name"] for r in removes))
            except OmadaError as e:
                results += [{"bookingId": r["bookingId"], "op": "remove", "ok": False, "error": str(e)} for r in removes]
    except OmadaError as e:
        check = str(e)
        log("controller: %s" % check)
    http("POST", pms + "/api/bridge/omada", {"results": results, "check": check}, auth)


def main():
    try:
        with open(CONFIG) as f:
            cfg = json.load(f)
    except Exception as e:
        log("no config %s (%s)" % (CONFIG, e))
        sys.exit(1)
    log("Corali bridge started → %s" % cfg.get("pms"))
    cache = {}
    while True:
        try:
            one_round(cfg, cache)
        except Exception as e:  # network down, PMS restarting…: try again next round
            log("round failed: %s" % e)
        time.sleep(EVERY)


if __name__ == "__main__":
    main()
