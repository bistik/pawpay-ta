// URL detection for chat messages. Links are never auto-linked into anchors —
// the UI renders them as buttons that open a confirmation prompt first, so a
// stranger can't hand over a one-tap trap. This module only finds and grades
// them.

export interface LinkMatch {
  start: number;
  end: number;
  href: string;
  host: string;
  // Raw IP host, punycode (xn--), or non-ASCII host — anything a homograph or
  // "click my server" link would use.
  suspicious: boolean;
}

// Only explicit schemes and `www.` — bare `domain.tld` matching would false
// positive on things like "e.g." or filenames.
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()]+/gi;
const IPV4_RE = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export function findLinks(text: string): LinkMatch[] {
  const out: LinkMatch[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0];
    // Trim sentence punctuation that the greedy match swallowed.
    const trimmed = raw.replace(/[.,;:!?)\]}"'»”’]+$/u, "");
    if (!trimmed) continue;

    const href = trimmed.startsWith("www.") ? `https://${trimmed}` : trimmed;

    let host: string;
    try {
      host = new URL(href).hostname;
    } catch {
      continue;
    }

    const suspicious =
      IPV4_RE.test(host) ||
      host.includes("xn--") ||
      /[^\x00-\x7f]/.test(host);

    out.push({
      start: m.index,
      end: m.index + trimmed.length,
      href,
      host,
      suspicious,
    });
  }
  return out;
}
