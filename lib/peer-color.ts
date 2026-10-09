// A stranger keeps one identity across surfaces: the same hue that colours their
// dot on the globe colours their avatar in the chat. The hue is confined to a
// 168–288° band (teal → blue → violet) so it can never collide with the warm
// "signal" colour that means you/action.
export function peerHue(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return 168 + (Math.abs(hash) % 120);
}

export function peerColor(id: string): string {
  return `oklch(0.8 0.13 ${peerHue(id)})`;
}

export function peerGlow(id: string): string {
  return `oklch(0.8 0.13 ${peerHue(id)} / 0.4)`;
}
