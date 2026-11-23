# Test stub: no network. Mimics tinytuya's read-only API surface used by ac_probe.py.
import socket


def deviceScan(verbose=False, maxretry=5, color=False):
    return {"192.168.10.21": {"ip": "192.168.10.21", "gwId": "bf1234567890abcdef", "version": "3.3", "productKey": "keyabc", "encrypt": True}}


class Device:
    def __init__(self, dev_id, ip, key, version=3.3):
        self.key = key

    def set_socketTimeout(self, s):
        pass

    def status(self):
        if self.key == "BADKEY_000":
            return {"Error": "Check device key or version", "Err": "914", "Payload": None}
        if self.key == "TIMEOUT_000":
            raise socket.timeout("timed out")
        return {"dps": {"1": True, "2": 24, "3": 27, "4": "cold", "5": "auto"}}

    def set_status(self, *a, **k):  # must never be called by the probe
        raise AssertionError("COMMAND SENT")

    def turn_on(self, *a, **k):
        raise AssertionError("COMMAND SENT")
