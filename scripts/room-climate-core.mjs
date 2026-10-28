// Room temperature / humidity sensors (Tuya Wi-Fi, e.g. Smart Life thermo-hygrometers) — pure rules, unit tested:
// reading the device's data points and deciding the three alerts (damp room, A/C not cooling / heating, low battery).

const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) && v !== "" && v !== null ? Math.min(hi, Math.max(lo, n)) : d; };

export function normalizeClimateSettings(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    humidityMax: Math.round(clamp(r.humidityMax, 40, 95, 70)), // %
    humidityHours: Math.round(clamp(r.humidityHours, 1, 48, 3)), // for this long → alert
    tempMax: clamp(r.tempMax, 20, 40, 28), // °C with a guest and the A/C powered
    tempMin: clamp(r.tempMin, 10, 24, 17),
    tempMinutes: Math.round(clamp(r.tempMinutes, 15, 240, 60)), // A/C on for this long and still too hot / cold → A/C fault
    batteryMin: Math.round(clamp(r.batteryMin, 5, 50, 20)), // %
  };
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const pickCode = (status, codes) => { for (const c of codes) { const dp = status.find((x) => x && x.code === c); if (dp) return dp.value; } return undefined; };

/**
 * Temperature (°C), humidity (%) and battery (%) from a Tuya device status. Tuya sends temperature ×10 on most
 * thermo-hygrometers (va_temperature 235 = 23.5 °C); battery may be a level ("low" / "middle" / "high").
 */
export function climateFromStatus(status) {
  if (!Array.isArray(status)) return null;
  let t = num(pickCode(status, ["va_temperature", "temp_current", "temperature", "temp_value"]));
  let h = num(pickCode(status, ["va_humidity", "humidity_value", "humidity", "humidity_current"]));
  if (t === null && h === null) return null;
  if (t !== null && Math.abs(t) > 60) t = t / 10;
  if (h !== null && h > 100) h = h / 10;
  const b = pickCode(status, ["battery_percentage", "battery", "va_battery", "battery_state"]);
  const level = { low: 10, middle: 50, high: 100 };
  const battery = num(b) ?? (typeof b === "string" && b in level ? level[b] : null);
  return { temp: t === null ? null : Math.round(t * 10) / 10, humidity: h === null ? null : Math.round(h), battery };
}

const DAY = 86_400_000;

/**
 * Next state and alerts for one room. row: { humid_since, hot_since, alerted_humid_at, alerted_temp_at,
 * alerted_battery_at }; reading: { temp, humidity, battery }; ctx: { occupied, acOnSince (ms or null; no A/C relay:
 * check-in time), now }. Alerts: "humid", "hot", "cold", "battery".
 */
export function evaluateClimate(row, reading, ctx, s) {
  const now = ctx.now, alerts = [], next = { ...row };
  // Damp room: humidity above the limit for the set hours (once a day).
  if (reading.humidity !== null && reading.humidity >= s.humidityMax) {
    next.humid_since = row.humid_since ?? now;
    if (now - next.humid_since >= s.humidityHours * 3_600_000 && (!row.alerted_humid_at || now - row.alerted_humid_at >= DAY)) { alerts.push("humid"); next.alerted_humid_at = now; }
  } else next.humid_since = null;
  // A/C fault: a guest is in, the A/C has had power long enough, and the room is still too hot / cold (twice a day at most).
  const outOfRange = reading.temp !== null && (reading.temp > s.tempMax || reading.temp < s.tempMin);
  const acLongEnough = ctx.occupied && ctx.acOnSince !== null && now - ctx.acOnSince >= s.tempMinutes * 60_000;
  if (outOfRange && acLongEnough) {
    next.hot_since = row.hot_since ?? now;
    if (now - next.hot_since >= 20 * 60_000 && (!row.alerted_temp_at || now - row.alerted_temp_at >= DAY / 2)) { alerts.push(reading.temp > s.tempMax ? "hot" : "cold"); next.alerted_temp_at = now; }
  } else next.hot_since = null;
  // Low battery (once a week).
  if (reading.battery !== null && reading.battery <= s.batteryMin && (!row.alerted_battery_at || now - row.alerted_battery_at >= 7 * DAY)) { alerts.push("battery"); next.alerted_battery_at = now; }
  return { next, alerts };
}
