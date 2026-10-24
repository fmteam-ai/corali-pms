// Generates the Corali TV message sounds (public/sounds/tv-*.wav): short bell / music-box tones synthesised here, so
// there are no third-party audio files or licences. Run: node scripts/generate-tv-sounds.mjs
import { mkdirSync, writeFileSync } from "node:fs";

const RATE = 22050;
const out = new URL("../public/sounds/", import.meta.url);
mkdirSync(out, { recursive: true });

const NOTE = { C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392.0, A4: 440.0, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.0, B5: 987.77, C6: 1046.5, E6: 1318.5 };

/** A bell-like tone: a few harmonics with exponential decay and a soft attack. */
function tone(buf, start, freq, { dur = 1.2, gain = 0.5, decay = 3.2, partials = [[1, 1], [2, 0.32], [3, 0.12], [4.2, 0.06]] } = {}) {
  const from = Math.round(start * RATE), n = Math.round(dur * RATE);
  for (let i = 0; i < n && from + i < buf.length; i++) {
    const t = i / RATE;
    const env = Math.min(1, t / 0.006) * Math.exp(-decay * t);
    let v = 0;
    for (const [mult, amp] of partials) v += amp * Math.sin(2 * Math.PI * freq * mult * t);
    buf[from + i] += gain * env * v;
  }
}

function wav(name, seconds, draw) {
  const buf = new Float32Array(Math.round(seconds * RATE));
  draw(buf);
  // Normalise to -3 dB and fade out the last 60 ms.
  const peak = buf.reduce((m, v) => Math.max(m, Math.abs(v)), 0) || 1;
  const fade = Math.round(0.06 * RATE);
  const pcm = Buffer.alloc(44 + buf.length * 2);
  pcm.write("RIFF", 0); pcm.writeUInt32LE(36 + buf.length * 2, 4); pcm.write("WAVE", 8);
  pcm.write("fmt ", 12); pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(RATE, 24); pcm.writeUInt32LE(RATE * 2, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36); pcm.writeUInt32LE(buf.length * 2, 40);
  for (let i = 0; i < buf.length; i++) {
    const tail = i > buf.length - fade ? (buf.length - i) / fade : 1;
    pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, (buf[i] / peak) * 0.7 * tail)) * 32767), 44 + i * 2);
  }
  writeFileSync(new URL(name, out), pcm);
  console.log(name, `${(pcm.length / 1024).toFixed(0)} KB`);
}

const musicBox = { dur: 1.1, decay: 4.5, partials: [[1, 1], [2, 0.45], [3, 0.18], [5.4, 0.05]] };

// Everyday message: soft two-note "ding-dong".
wav("tv-standard.wav", 2.4, (b) => { tone(b, 0, NOTE.E6 / 2, { dur: 1.6 }); tone(b, 0.42, NOTE.C5, { dur: 1.9 }); });

// Urgent: three clear, brighter tones.
wav("tv-urgent.wav", 2.0, (b) => { for (const t of [0, 0.32, 0.64]) tone(b, t, NOTE.B5, { dur: 0.9, decay: 6, partials: [[1, 1], [2, 0.5], [3, 0.25]] }); tone(b, 0.96, NOTE.E6, { dur: 1.0, decay: 4.5 }); });

// Birthday: first phrase of "Happy Birthday to You" (public domain) as a music box.
wav("tv-birthday.wav", 4.4, (b) => {
  const beat = 0.42;
  const phrase = [["G4", 0.75], ["G4", 0.25], ["A4", 1], ["G4", 1], ["C5", 1], ["B4", 2]];
  let t = 0;
  for (const [note, beats] of phrase) { tone(b, t, NOTE[note] * 2, { ...musicBox, dur: Math.max(0.9, beats * beat + 0.6) }); t += beats * beat; }
});

// Anniversary: gentle rising harp arpeggio C–E–G–C–E.
wav("tv-anniversary.wav", 3.4, (b) => { ["C5", "E5", "G5", "C6", "E6"].forEach((n, i) => tone(b, i * 0.22, NOTE[n], { dur: 2.2, decay: 2.4, gain: 0.45 })); });

// Celebration: quick sparkling arpeggio up and a final chord.
wav("tv-celebration.wav", 3.0, (b) => {
  ["G4", "C5", "E5", "G5", "C6"].forEach((n, i) => tone(b, i * 0.12, NOTE[n], { ...musicBox, dur: 1.4 }));
  for (const n of ["C5", "E5", "G5"]) tone(b, 0.75, NOTE[n], { dur: 2.0, decay: 2.2, gain: 0.35 });
});

// PMS: a guest request from a room TV — two bright "ding-ding" pairs, clearly different from the TV message sounds.
wav("pms-request.wav", 2.2, (b) => { for (const t of [0, 0.7]) { tone(b, t, NOTE.E6 / 2 * 2, { dur: 0.8, decay: 5, gain: 0.5 }); tone(b, t + 0.16, NOTE.G5 * 2, { dur: 1.0, decay: 4.5, gain: 0.45 }); } });
