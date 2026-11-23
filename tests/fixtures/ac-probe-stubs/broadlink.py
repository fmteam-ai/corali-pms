# Test stub: no network. Unlocked module that authenticates, one locked, one that times out, one that refuses.
class NetworkTimeoutError(Exception):
    pass


class AuthenticationError(Exception):
    pass


class _Dev:
    def __init__(self, ip, mac, locked, auth="ok"):
        self.host = (ip, 80); self.mac = bytes(mac); self.devtype = 0x4E2A; self.model = "AC"; self.manufacturer = "AUX"; self.is_locked = locked; self._auth = auth

    def auth(self):
        if self._auth == "timeout":
            raise NetworkTimeoutError("No response received within the timeout period")
        if self._auth == "refuse":
            raise AuthenticationError("Authentication failed")
        return True

    def send_packet(self, *a, **k):  # must never be called by the probe
        raise AssertionError("COMMAND SENT")


def discover(timeout=5):
    return [
        _Dev("192.168.10.31", [0x34, 0xEA, 0x34, 1, 2, 3], False),
        _Dev("192.168.10.32", [0xB4, 0x43, 0x0D, 4, 5, 6], True),
        _Dev("192.168.10.33", [0x78, 0x0F, 0x77, 7, 8, 9], False, "timeout"),
        _Dev("192.168.10.34", [0xC8, 0xF7, 0x42, 1, 1, 1], False, "refuse"),
    ]
