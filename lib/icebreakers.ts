// Conversation starters and quick replies. Purely cosmetic — they exist to
// soften the "two strangers, blank slate" moment.

export const ICEBREAKERS = [
  "Where in the world are you joining from?",
  "What's the last thing that made you laugh?",
  "Coffee or tea — and how do you take it?",
  "What's one small thing that made today better?",
  "If you could teleport anywhere right now, where?",
  "What are you looking forward to this week?",
  "Best meal you've had recently?",
  "What's a hobby you'd recommend to a stranger?",
];

export const QUICK_REPLIES = [
  "Hi 👋",
  "Hello",
  "How's it going?",
  "Where are you from?",
  "Nice to meet you 🙂",
  "Talk later 👋",
];

// Stable per peer, so the same connection doesn't reshuffle on every render.
export function pickIcebreaker(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return ICEBREAKERS[h % ICEBREAKERS.length];
}
