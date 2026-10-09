"use client";

// The short authentication string, shown once both peers have exchanged SDP.
// It is the same on both screens unless something rewrote the fingerprints in
// flight — so two strangers can read it aloud to rule out a relay.
export default function SecureBadge({ code }: { code: string | null }) {
  if (!code) return null;
  return (
    <span
      className="chip panel-glass shrink-0 gap-1.5 font-medium"
      title="Read this code aloud with the stranger. If it matches on both screens, no one is relaying your call."
      aria-label={`Secure code ${code}. Compare it with the stranger.`}
    >
      <span aria-hidden="true">🛡️</span>
      <span aria-hidden="true" className="tracking-widest">
        {code}
      </span>
    </span>
  );
}
