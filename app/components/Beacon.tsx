// The Pulse mark: a warm core emitting rings, the same visual language as a
// peer dot on the map. Decorative only, so it is hidden from assistive tech.
export default function Beacon({
  size = "lg",
  animated = true,
  className = "",
}: {
  size?: "lg" | "sm";
  animated?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`beacon beacon--${size} ${animated ? "" : "beacon--static"} ${className}`}
    >
      <span className="beacon__ring" />
      <span className="beacon__ring" />
      <span className="beacon__ring" />
      <span className="beacon__core" />
    </span>
  );
}
