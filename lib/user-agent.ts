// Device of a sign-in from its User-Agent (pure; unit tested): kind (computer / phone / tablet), system and browser.
export type DeviceInfo = { kind: "computer" | "phone" | "tablet" | "tv" | "unknown"; os: string; browser: string };

export function deviceFromUserAgent(ua: string): DeviceInfo {
  const s = String(ua ?? "");
  if (!s) return { kind: "unknown", os: "", browser: "" };
  const kind: DeviceInfo["kind"] = /SmartTV|GoogleTV|Android TV|AFT[A-Z]|BRAVIA|Web0S|Tizen/i.test(s) ? "tv"
    : /iPad|Tablet|Android(?!.*Mobile)/i.test(s) ? "tablet"
    : /Mobi|iPhone|iPod|Android.*Mobile/i.test(s) ? "phone" : "computer";
  const v = (re: RegExp) => s.match(re)?.[1]?.replace(/_/g, ".") ?? "";
  const os = /iPhone|iPad|iPod/.test(s) ? `iOS ${v(/OS (\d+[_.]\d+)/)}`.trim()
    : /Android/.test(s) ? `Android ${v(/Android (\d+(?:\.\d+)?)/)}`.trim()
    : /Windows NT 10/.test(s) ? "Windows 10/11" : /Windows NT/.test(s) ? "Windows"
    : /Mac OS X/.test(s) ? `macOS ${v(/Mac OS X (\d+[_.]\d+)/)}`.trim()
    : /CrOS/.test(s) ? "ChromeOS" : /Linux/.test(s) ? "Linux" : "";
  const browser = /Edg\//.test(s) ? `Edge ${v(/Edg\/(\d+)/)}` : /OPR\//.test(s) ? `Opera ${v(/OPR\/(\d+)/)}`
    : /SamsungBrowser\//.test(s) ? `Samsung Internet ${v(/SamsungBrowser\/(\d+)/)}`
    : /Firefox\//.test(s) ? `Firefox ${v(/Firefox\/(\d+)/)}` : /CriOS\//.test(s) ? `Chrome ${v(/CriOS\/(\d+)/)}`
    : /Chrome\//.test(s) ? `Chrome ${v(/Chrome\/(\d+)/)}` : /Safari\//.test(s) && /Version\//.test(s) ? `Safari ${v(/Version\/(\d+)/)}`
    : /curl|python|node|axios|Go-http/i.test(s) ? "Script / bot" : "";
  return { kind, os, browser: browser.trim() };
}

/** First address of an X-Forwarded-For chain, and whether it is a private / local network. */
export function primaryAddress(chain: string): { ip: string; local: boolean } {
  const ip = String(chain ?? "").split(",")[0]?.trim() ?? "";
  return { ip, local: /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|::1$|fc|fd|fe80)/i.test(ip) };
}
