"use client";

import type { ReactNode } from "react";
import { findLinks, type LinkMatch } from "@/lib/links";

// Renders a message body, turning URLs into buttons rather than anchors — a
// stranger's link should never be one tap away, so a click opens a confirmation
// prompt instead of navigating. Styling inherits the bubble's text colour, so
// it reads on both the amber (mine) and surface (theirs) bubbles.
export default function MessageText({
  text,
  onLinkClick,
}: {
  text: string;
  onLinkClick: (link: LinkMatch) => void;
}) {
  const links = findLinks(text);
  if (links.length === 0) return <>{text}</>;

  const nodes: ReactNode[] = [];
  let cursor = 0;
  links.forEach((link, i) => {
    if (link.start > cursor) nodes.push(text.slice(cursor, link.start));
    nodes.push(
      <button
        key={i}
        type="button"
        onClick={() => onLinkClick(link)}
        aria-label={`Open link ${link.host}`}
        className="inline break-all text-left font-medium underline decoration-dotted underline-offset-2 transition-[text-decoration-style] hover:decoration-solid"
      >
        {text.slice(link.start, link.end)}
        <span aria-hidden="true"> ↗</span>
      </button>,
    );
    cursor = link.end;
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));

  return <>{nodes}</>;
}
