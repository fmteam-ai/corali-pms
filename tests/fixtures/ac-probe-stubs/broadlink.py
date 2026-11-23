# Test stub: no network. One unlocked AUX-like module, one locked.
class _Dev:
    def __init__(self, ip, mac, locked):
        self.host = (ip, 80); self.mac = bytes(mac); self.devtype = 0x4E2A; self.model = "AC"; self.manufacturer = "AUX"; self.is_locked = locked
    def auth(self):
        return True
    def send_packet(self, *a, **k):  # must never be called by the probe
        raise AssertionError("COMMAND SENT")

def discover(timeout=5):
    return [_Dev("192.168.10.31", [0x34, 0xEA, 0x34, 1, 2, 3], False), _Dev("192.168.10.32", [0xB4, 0x43, 0x0D, 4, 5, 6], True)]
