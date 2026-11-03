import assert from "node:assert/strict";
import test from "node:test";
import { deviceFromUserAgent, primaryAddress } from "../lib/user-agent.ts";

test("device from the User-Agent", () => {
  assert.deepEqual(deviceFromUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"), { kind: "computer", os: "Windows 10/11", browser: "Chrome 141" });
  assert.deepEqual(deviceFromUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1"), { kind: "phone", os: "iOS 18.5", browser: "Safari 18" });
  assert.equal(deviceFromUserAgent("Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36").kind, "tablet");
  assert.equal(deviceFromUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15 Edg/141.0").browser, "Edge 141");
  assert.equal(deviceFromUserAgent("curl/8.5.0").browser, "Script / bot");
  assert.deepEqual(primaryAddress("85.73.10.4, 10.0.0.2"), { ip: "85.73.10.4", local: false });
  assert.equal(primaryAddress("192.168.1.20").local, true);
});
