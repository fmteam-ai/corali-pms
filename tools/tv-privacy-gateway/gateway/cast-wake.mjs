// EXPERIMENTAL Power ON probe (v161) — NOT used by the PMS until proven on the HORIZON in room 112.
// Evidence so far: a phone casting YouTube on the same Wi-Fi wakes the TV from standby ("Wake On Chromecast" on).
// This sends the same kind of request from the on-prem gateway: a Google Cast (CASTV2) LAUNCH of the Default Media
// Receiver over TLS port 8009 on the TV's LAN address. It never changes any setting on the TV.
//
//   node gateway/cast-wake.mjs 192.168.10.120          (TV in standby, gateway on the same network)
//
// Result: prints what the TV answered. Whether the screen came on must be checked by eye and written down.
import tls from 'node:tls';
import { fileURLToPath } from 'node:url';

// CastMessage protobuf (cast_channel.proto), encoded by hand: protocol_version=0, source_id, destination_id,
// namespace, payload_type=STRING(0), payload_utf8. Framed with a 4-byte big-endian length.
const varint = (n) => { const b = []; while (n > 127) { b.push((n & 127) | 128); n >>>= 7; } b.push(n); return Buffer.from(b); };
const field = (no, s) => { const v = Buffer.from(s, 'utf8'); return Buffer.concat([varint((no << 3) | 2), varint(v.length), v]); };
export function castMessage(source, destination, namespace, payload) {
  const body = Buffer.concat([Buffer.from([0x08, 0x00]), field(2, source), field(3, destination), field(4, namespace), Buffer.from([0x28, 0x00]), field(6, JSON.stringify(payload))]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(body.length);
  return Buffer.concat([len, body]);
}

/** Split a byte stream into CastMessage JSON payloads (for printing the TV's answers). */
export function readPayloads(buf) {
  const out = [];
  while (buf.length >= 4 && buf.length >= 4 + buf.readUInt32BE(0)) {
    const msg = buf.subarray(4, 4 + buf.readUInt32BE(0)).toString('utf8');
    buf = buf.subarray(4 + buf.readUInt32BE(0));
    const m = msg.match(/\{.*\}/s);
    if (m) out.push(m[0]);
  }
  return { payloads: out, rest: buf };
}

const NS_CONN = 'urn:x-cast:com.google.cast.tp.connection';
const NS_RECV = 'urn:x-cast:com.google.cast.receiver';
const NS_HEART = 'urn:x-cast:com.google.cast.tp.heartbeat';

function main(ip) {
  // The TV's Cast certificate is self-signed by Google's device CA; this probe only sends a LAUNCH, no data.
  // In standby the Wi-Fi chip may only wake on traffic (WoWLAN): retry the connection for up to ~40 s.
  let attempt = 0;
  const tryConnect = () => {
    attempt++;
    const sock = tls.connect({ host: ip, port: 8009, rejectUnauthorized: false, timeout: 4000 }, () => {
      console.log(`Connected to ${ip}:8009 (attempt ${attempt}) — sending CONNECT + LAUNCH (Default Media Receiver)`);
      sock.write(castMessage('sender-corali', 'receiver-0', NS_CONN, { type: 'CONNECT' }));
      sock.write(castMessage('sender-corali', 'receiver-0', NS_HEART, { type: 'PING' }));
      sock.write(castMessage('sender-corali', 'receiver-0', NS_RECV, { type: 'LAUNCH', appId: 'CC1AD845', requestId: 1 }));
      setTimeout(() => { sock.end(); console.log('Done. Did the screen turn on? Note the result (yes/no, seconds).'); process.exit(0); }, 10000);
    });
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => {
      const r = readPayloads(Buffer.concat([buf, d]));
      buf = r.rest;
      for (const p of r.payloads) console.log('TV:', p.slice(0, 200));
    });
    const retry = (why) => {
      sock.destroy();
      if (attempt >= 10) { console.log(`No connection after ${attempt} attempts (${why}) — the TV did not answer on 8009 (deep standby?).`); process.exit(1); }
      setTimeout(tryConnect, 3000);
    };
    sock.on('timeout', () => retry('timeout'));
    sock.on('error', (e) => retry(e.code || e.message));
  };
  tryConnect();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ip = process.argv[2] ?? '';
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) { console.error('Usage: node gateway/cast-wake.mjs <TV LAN IPv4>'); process.exit(2); }
  main(ip);
}
