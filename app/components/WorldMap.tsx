"use client";

import { useEffect, useRef, useState } from "react";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Map as MapboxMap, Marker } from "mapbox-gl";
import type { PeerDot } from "@/lib/types";
import { peerColor, peerGlow } from "@/lib/peer-color";
import Beacon from "./Beacon";

const TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? "";

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export default function WorldMap({
  peers,
  me,
  onPeerClick,
  canConnect,
}: {
  peers: PeerDot[];
  me: { lat: number; lng: number } | null;
  onPeerClick: (id: string) => void;
  canConnect: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const meMarkerRef = useRef<Marker | null>(null);
  const [ready, setReady] = useState(false);

  // Marker click handlers are bound once, so read the live click handler +
  // connectability through refs (synced in an effect, never during render).
  const onPeerClickRef = useRef(onPeerClick);
  const canConnectRef = useRef(canConnect);
  useEffect(() => {
    onPeerClickRef.current = onPeerClick;
    canConnectRef.current = canConnect;
  });

  // Initialise the map once.
  useEffect(() => {
    const container = containerRef.current;
    if (!TOKEN || !container) return;
    let cancelled = false;
    const markers = markersRef.current;

    // Slow idle rotation of the globe. Pauses on any user gesture and resumes
    // after a beat; entirely disabled under reduced-motion.
    const reduced = prefersReducedMotion();
    let raf = 0;
    let bearing = me ? 0 : -14;
    let pausedUntil = 0;
    const pause = () => {
      pausedUntil = performance.now() + 6000;
    };
    const step = () => {
      if (performance.now() > pausedUntil) {
        bearing = (bearing + 0.015) % 360;
        mapRef.current?.setBearing(bearing);
      }
      raf = requestAnimationFrame(step);
    };

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled || !containerRef.current) return;
      mapboxgl.accessToken = TOKEN;
      const map = new mapboxgl.Map({
        container,
        style: "mapbox://styles/mapbox/dark-v11",
        projection: "globe",
        // Open on the user when we know where they are, else a world view.
        center: me ? [me.lng, me.lat] : [0, 12],
        zoom: me ? 2.6 : 1.1,
        bearing,
        minZoom: 1,
        maxZoom: 12,
        attributionControl: true,
        logoPosition: "bottom-right",
      });
      map.on("load", () => {
        if (cancelled) return;

        // Atmosphere: a lit rim against deep space, with stars behind it.
        map.setFog({
          color: "rgb(14, 20, 36)",
          "high-color": "rgb(30, 44, 74)",
          "horizon-blend": 0.06,
          "space-color": "rgb(5, 7, 14)",
          "star-intensity": 0.5,
        });

        setReady(true);
      });
      mapRef.current = map;

      container.addEventListener("pointerdown", pause);
      container.addEventListener("wheel", pause, { passive: true });
      container.addEventListener("touchstart", pause, { passive: true });
      if (!reduced) raf = requestAnimationFrame(step);
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      container.removeEventListener("pointerdown", pause);
      container.removeEventListener("wheel", pause);
      container.removeEventListener("touchstart", pause);
      markers.forEach((m) => m.remove());
      markers.clear();
      meMarkerRef.current?.remove();
      meMarkerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
    // `me` is only read for the initial center; we don't want to re-init on change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show / move the user's own "you are here" beacon.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !me) return;
    let cancelled = false;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled) return;
      if (!meMarkerRef.current) {
        const el = document.createElement("div");
        el.className = "pulse-me";
        el.title = "You are here";
        el.innerHTML =
          '<span class="pulse-me__label">You</span><span class="pulse-me__core"></span>';
        meMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: "center" })
          .setLngLat([me.lng, me.lat])
          .addTo(map);
      } else {
        meMarkerRef.current.setLngLat([me.lng, me.lat]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [me, ready]);

  // Reconcile markers whenever the peer list changes (or the map becomes ready).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let cancelled = false;

    (async () => {
      const mapboxgl = (await import("mapbox-gl")).default;
      if (cancelled) return;
      const markers = markersRef.current;
      const seen = new Set<string>();

      for (const peer of peers) {
        seen.add(peer.id);
        let marker = markers.get(peer.id);
        if (!marker) {
          const el = document.createElement("button");
          el.type = "button";
          el.className = "pulse-dot";
          el.style.setProperty("--dot", peerColor(peer.id));
          el.style.setProperty("--dot-glow", peerGlow(peer.id));

          const label = document.createElement("span");
          label.className = "pulse-dot__label";
          label.textContent = "Connect";
          el.appendChild(label);

          el.addEventListener("click", (e) => {
            e.stopPropagation();
            if (canConnectRef.current) onPeerClickRef.current(peer.id);
          });

          marker = new mapboxgl.Marker({ element: el, anchor: "center" })
            .setLngLat([peer.lng, peer.lat])
            .addTo(map);
          markers.set(peer.id, marker);
        }

        // Busy / available is a shape + label change, not just opacity.
        const el = marker.getElement();
        el.classList.toggle("is-busy", peer.busy);
        el.title = peer.busy ? "This stranger is busy" : "Connect with this stranger";
        el.setAttribute(
          "aria-label",
          peer.busy ? "Stranger is busy" : "Connect with a stranger",
        );
        const label = el.querySelector(".pulse-dot__label");
        if (label) label.textContent = peer.busy ? "Busy" : "Connect";
      }

      // Drop markers for peers that went offline / got filtered out.
      for (const [id, marker] of markers) {
        if (!seen.has(id)) {
          marker.remove();
          markers.delete(id);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [peers, ready]);

  const onlineCopy =
    peers.length === 0
      ? "Only you, right now"
      : `${peers.length} ${peers.length === 1 ? "stranger" : "strangers"} online`;

  return (
    <div className="absolute inset-0">
      <div ref={containerRef} className="h-full w-full bg-void" />

      {!TOKEN && (
        <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
          <p className="max-w-md rounded-panel panel-glass p-4 text-sm text-fg-muted">
            Set{" "}
            <code className="font-mono text-signal">NEXT_PUBLIC_MAPBOX_TOKEN</code>{" "}
            in <code className="font-mono text-signal">.env</code> to load the globe.
          </p>
        </div>
      )}

      {/* Scrim so the brand chrome stays legible over bright map regions. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-void/85 to-transparent"
      />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="flex flex-col items-start gap-2">
          <div className="flex items-center gap-2.5">
            <Beacon size="sm" animated={false} />
            <span className="text-sm font-semibold tracking-tight text-fg">
              Pulse
            </span>
          </div>
          <span className="chip panel-glass">
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 rounded-full bg-presence shadow-[0_0_8px_var(--presence)]"
            />
            {onlineCopy}
          </span>
        </div>
      </div>
    </div>
  );
}
