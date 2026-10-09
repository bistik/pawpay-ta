// Short authentication string (SAS) for the WebRTC session.
//
// Both peers already exchange DTLS fingerprints inside their SDP. Hashing the
// two fingerprints together — in a canonical (sorted) order — yields a short
// code that is identical on both ends *only if* no one rewrote the SDP in
// flight. Displaying it lets two strangers compare out loud and rule out a
// man-in-the-middle. It proves nothing on its own unless the humans compare.

// Night/globe-themed. 24 symbols over 4 slots ≈ 331k combinations.
const PALETTE = [
  "🌙", "⭐", "✨", "🔒", "🗝️", "🌍", "🛰️", "🦊",
  "🐢", "🐙", "🦉", "🐬", "🌵", "🍀", "🌊", "🔥",
  "❄️", "⚡", "🌈", "🧭", "🛡️", "💎", "🎈", "🎯",
];

const SLOTS = 4;

export function extractFingerprint(sdp: string): string | null {
  const m = sdp.match(/^a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/m);
  return m ? m[1].replace(/:/g, "").toLowerCase() : null;
}

export async function deriveSecureCode(
  localSdp: string,
  remoteSdp: string,
): Promise<string | null> {
  const a = extractFingerprint(localSdp);
  const b = extractFingerprint(remoteSdp);
  if (!a || !b) return null;

  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return null; // non-secure context (plain http on a LAN, etc.)

  const [x, y] = a < b ? [a, b] : [b, a];
  const digest = await subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${x}:${y}`),
  );
  const bytes = new Uint8Array(digest);

  return Array.from(
    { length: SLOTS },
    (_, i) => PALETTE[bytes[i] % PALETTE.length],
  ).join(" ");
}
