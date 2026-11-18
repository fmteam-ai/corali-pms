// EXPERIMENTAL Power ON probe (v161) — NOT used by the PMS until proven on the HORIZON in room 112.
// Evidence: a phone casting YouTube on the same Wi-Fi wakes the TV from standby; a direct Cast (TLS 8009) to the
// sleeping TV does not answer (tested 18/11, 1 min after standby). Phones first discover Cast devices with mDNS and some
// TVs wake on that, or on a Wake-on-LAN magic packet. This probe sends, in order:
//   1. Wake-on-LAN magic packets (only if the TV's MAC address is given), 2. mDNS queries for _googlecast._tcp,
//   3. a Google Cast LAUNCH of the Default Media Receiver over TLS 8009, retried for ~60 s.
// It never changes any setting on the TV.
//
//   node cast-wake.mjs 192.168.10.120                      (mDNS + Cast)
//   node cast-wake.mjs 192.168.10.120 AA:BB:CC:DD:EE:FF    (+ Wake-on-LAN; MAC: arp -a 192.168.10.120 while the TV is on)
import tls from 'node:tls';
import dgram from 'node:dgram';
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

/** Wake-on-LAN magic packet: 6 × 0xFF + the MAC 16 times. */
export function magicPacket(mac) {
  const hex = String(mac).replace(/[^0-9a-fA-F]/g, '');
  if (hex.length !== 12) throw new Error('BAD_MAC');
  const m = Buffer.from(hex, 'hex');
  return Buffer.concat([Buffer.alloc(6, 0xff), ...Array(16).fill(m)]);
}

/** mDNS query (PTR) for _googlecast._tcp.local — what phones send to find Cast devices. */
export function mdnsQuery() {
  const labels = ['_googlecast', '_tcp', 'local'];
  const name = Buffer.concat([...labels.map((l) => Buffer.concat([Buffer.from([l.length]), Buffer.from(l)])), Buffer.from([0])]);
  const header = Buffer.from([0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0]);
  return Buffer.concat([header, name, Buffer.from([0x00, 0x0c, 0x00, 0x01])]);
}

const NS_CONN = 'urn:x-cast:com.google.cast.tp.connection';
const NS_RECV = 'urn:x-cast:com.google.cast.receiver';
const NS_HEART = 'urn:x-cast:com.google.cast.tp.heartbeat';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function nudge(ip, mac) {
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  await new Promise((r) => sock.bind(0, r));
  sock.setBroadcast(true);
  const subnet = ip.replace(/\.\d+$/, '.255');
  const send = (buf, port, host) => new Promise((r) => sock.send(buf, port, host, () => r()));
  for (let i = 0; i < 3; i++) {
    if (mac) {
      const p = magicPacket(mac);
      for (const host of ['255.255.255.255', subnet, ip]) { await send(p, 9, host); await send(p, 7, host); }
    }
    await send(mdnsQuery(), 5353, '224.0.0.251');
    await send(mdnsQuery(), 5353, ip);
    await pause(500);
  }
  sock.close();
  console.log(`${new Date().toLocaleTimeString()} Sent ${mac ? 'Wake-on-LAN + ' : ''}mDNS discovery. Trying Cast for ~60 s…`);
}

function cast(ip) {
  const started = Date.now();
  let attempt = 0;
  const tryConnect = () => {
    attempt++;
    const sock = tls.connect({ host: ip, port: 8009, rejectUnauthorized: false, timeout: 4000 }, () => {
      sock.setTimeout(0);
      console.log(`Connected to ${ip}:8009 after ${Math.round((Date.now() - started) / 1000)} s (attempt ${attempt}) — sending LAUNCH`);
      sock.write(castMessage('sender-corali', 'receiver-0', NS_CONN, { type: 'CONNECT' }));
      sock.write(castMessage('sender-corali', 'receiver-0', NS_HEART, { type: 'PING' }));
      sock.write(castMessage('sender-corali', 'receiver-0', NS_RECV, { type: 'LAUNCH', appId: 'CC1AD845', requestId: 1 }));
      setTimeout(() => { sock.end(); console.log('Done. Did the screen turn on? Note the result (yes/no, seconds).'); process.exit(0); }, 8000);
    });
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => {
      const r = readPayloads(Buffer.concat([buf, d]));
      buf = r.rest;
      for (const p of r.payloads) console.log('TV:', p.slice(0, 160));
    });
    let done = false;
    const retry = (why) => {
      if (done) return;
      done = true;
      sock.destroy();
      if (attempt >= 15) { console.log(`No connection after ${attempt} attempts (${why}) — the TV did not answer on 8009.`); process.exit(1); }
      setTimeout(tryConnect, 3000);
    };
    sock.on('timeout', () => retry('timeout'));
    sock.on('error', (e) => retry(e.code || e.message));
  };
  tryConnect();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const ip = process.argv[2] ?? '';
  const mac = process.argv[3];
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip) || (mac && !/^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/.test(mac))) {
    console.error('Usage: node cast-wake.mjs <TV LAN IPv4> [TV MAC AA:BB:CC:DD:EE:FF]');
    process.exit(2);
  }
  nudge(ip, mac).then(() => cast(ip));
}
