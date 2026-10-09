// Client-side profanity masking.
//
// This is a speed bump, not a wall: chat rides WebRTC peer-to-peer, so a
// patched client can simply choose not to run it. It runs on send (so the wire
// never carries the raw word) and again on render, so both ends see the same
// thing and a modified sender can't smuggle text through unmasked.
//
// Matching is deliberately whole-word: the message is folded (leet spellings,
// accents and repeated letters collapsed) and each folded word is compared
// against a curated list. Substring matching is never used, which is what keeps
// "Scunthorpe" / "assassin" / "classic" out of the net. The one evasion we do
// chase is spaced-out letters ("f u c k").

// Deliberately short and unambiguous. Do NOT add anything that is a substring
// of an ordinary word — whole-word matching is the entire safety property.
const BLOCKED = new Set<string>([
  "fuck",
  "fuk",
  "fucker",
  "fuckers",
  "fucking",
  "motherfucker",
  "motherfuckers",
  "shit",
  "shitty",
  "bullshit",
  "horseshit",
  "bitch",
  "bitches",
  "bastard",
  "bastards",
  "asshole",
  "assholes",
  "dickhead",
  "dickheads",
  "cunt",
  "cunts",
  "twat",
  "twats",
  "prick",
  "pricks",
  "douche",
  "douchebag",
  "wanker",
  "wankers",
  "bollocks",
  "scumbag",
  "whore",
  "whores",
  "slut",
  "sluts",
  "nigger",
  "niggers",
  "nigga",
  "niggas",
  "faggot",
  "faggots",
  "fag",
  "fags",
  "retard",
  "retards",
  "kike",
  "spic",
  "chink",
]);

// Common character substitutions, applied before matching.
const LEET: Record<string, string> = {
  "4": "a",
  "@": "a",
  "3": "e",
  "1": "i",
  "!": "i",
  "|": "i",
  "0": "o",
  $: "s",
  "5": "s",
  "7": "t",
  "+": "t",
};

// Fold a word to its comparison key: lowercase, strip accents, map leet
// characters, drop anything that isn't alphanumeric, and collapse runs of the
// same character to one ("fuuuck" → "fuck"). The dictionary is folded through
// the same function so both sides meet in the middle.
function fold(word: string): string {
  // A trailing symbol is punctuation, not a letter stand-in — trim it first so
  // "shit$" doesn't fold to "shits". Interior symbols ("sh!t") still map.
  const core = word.replace(/[@$!|]+$/, "");
  let out = "";
  let prev = "";
  for (const ch of core
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")) {
    const mapped = LEET[ch] ?? ch;
    if (!/[a-z0-9]/.test(mapped)) continue;
    if (mapped === prev) continue;
    out += mapped;
    prev = mapped;
  }
  return out;
}

const BLOCKED_FOLDED = new Set<string>([...BLOCKED].map(fold));

// Words. The `!`/`|` stand-ins are only pulled into a token when they sit
// between letters ("sh!t"), so trailing sentence punctuation stays untouched.
const TOKEN_RE = /[A-Za-z0-9@$]+(?:[!|]+[A-Za-z0-9@$]+)*/g;

interface Span {
  start: number;
  end: number;
}

// Find the spans of the original string that should be masked.
function scan(input: string): Span[] {
  const tokens: { start: number; end: number; raw: string; folded: string }[] = [];
  for (const m of input.matchAll(TOKEN_RE)) {
    const raw = m[0];
    tokens.push({
      start: m.index,
      end: m.index + raw.length,
      raw,
      folded: fold(raw),
    });
  }

  const hits = new Set<number>();

  // Pass A — whole-token match.
  tokens.forEach((t, i) => {
    if (t.folded && BLOCKED_FOLDED.has(t.folded)) hits.add(i);
  });

  // Pass B — runs of single letters spelling a blocked word ("f u c k").
  let i = 0;
  while (i < tokens.length) {
    const singleLetter = /^[A-Za-z]$/.test(tokens[i].raw);
    if (!singleLetter) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < tokens.length && /^[A-Za-z]$/.test(tokens[j + 1].raw)) j++;
    if (j > i) {
      const joined = tokens
        .slice(i, j + 1)
        .map((t) => t.folded)
        .join("");
      if (BLOCKED_FOLDED.has(joined)) {
        for (let k = i; k <= j; k++) hits.add(k);
      }
    }
    i = j + 1;
  }

  return [...hits]
    .map((i) => ({ start: tokens[i].start, end: tokens[i].end }))
    .sort((a, b) => a.start - b.start);
}

// Keep the first character and bullet out the rest, so a bubble keeps its
// shape. A masked word has no letters left, which makes this idempotent.
function maskWord(word: string): string {
  return word.length <= 1 ? "•" : word[0] + "•".repeat(word.length - 1);
}

export function censorText(input: string): { text: string; censored: boolean } {
  const spans = scan(input);
  if (spans.length === 0) return { text: input, censored: false };

  let out = "";
  let cursor = 0;
  for (const span of spans) {
    out += input.slice(cursor, span.start);
    out += maskWord(input.slice(span.start, span.end));
    cursor = span.end;
  }
  out += input.slice(cursor);
  return { text: out, censored: true };
}

export function containsBlocked(input: string): boolean {
  return scan(input).length > 0;
}
