import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import type { ObservedFact } from "../../intel/types";
import { contactKinematics, offsetCoordByMotion } from "../../scene/kinematics";
import {
  buildTrackRingPolygonsGeoJson,
  circleRing,
  collectSensorFootprints,
  FIXED_SENSOR_SITES,
  isSensorEntityFact,
  isWithinSensorRange,
  nearestSensor,
  triangleRing,
  type SensorFootprint,
} from "../../scene/sensors";
import {
  clampLngLatToTheater,
  factToLngLat,
  formatCoordLabel,
  TAIWAN_BOUNDS,
  TAIWAN_CENTER,
  TAIWAN_MAX_BOUNDS,
} from "../../scene/theater";
import type { OverviewTrack } from "../ops/types";
import "maplibre-gl/dist/maplibre-gl.css";
import styles from "./SituationalMap.module.css";

const PORT_A_CENTER = TAIWAN_CENTER;
const LIGHT_OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "&copy; OpenStreetMap contributors",
    },
  },
  layers: [
    {
      id: "osm",
      type: "raster",
      source: "osm",
      minzoom: 0,
      maxzoom: 19,
    },
  ],
};
const DARK_OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
        "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
      ],
      tileSize: 256,
      attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
    },
  },
  layers: [
    {
      id: "carto-dark",
      type: "raster",
      source: "carto",
      minzoom: 0,
      maxzoom: 20,
    },
  ],
};
const protocol = new Protocol();
let pmtilesProtocolRegistered = false;

const MAP_STYLE_MODE =
  (import.meta.env.VITE_MAP_STYLE_MODE as string | undefined) ?? "osm-dark";
const PMTILES_BASE_URL =
  (import.meta.env.VITE_MAP_PMTILES_BASE_URL as string | undefined) ??
  "http://localhost:3000/satellite.pmtiles";
const PMTILES_DEM_URL =
  (import.meta.env.VITE_MAP_PMTILES_DEM_URL as string | undefined) ??
  "http://localhost:3000/dem.pmtiles";

function terrainPmtilesStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      "offline-tiles": {
        type: "raster",
        url: `pmtiles://${PMTILES_BASE_URL}`,
        tileSize: 256,
      },
      terrainSource: {
        type: "raster-dem",
        url: `pmtiles://${PMTILES_DEM_URL}`,
        tileSize: 256,
      },
      hillshadeSource: {
        type: "raster-dem",
        url: `pmtiles://${PMTILES_DEM_URL}`,
        tileSize: 256,
      },
    },
    layers: [
      {
        id: "offline-layer",
        type: "raster",
        source: "offline-tiles",
      },
      {
        id: "hills",
        type: "hillshade",
        source: "hillshadeSource",
        layout: { visibility: "visible" },
        paint: { "hillshade-shadow-color": "#333" },
      },
    ],
    terrain: {
      source: "terrainSource",
      exaggeration: 1.6,
    },
  };
}

export type MapLayerMode = "main" | "sensors" | "threats" | "zones";

type SituationalMapProps = {
  facts: ObservedFact[];
  tracks?: OverviewTrack[];
  selectedTrackId?: string;
  focusFactId?: string;
  focusNonce?: number;
  /** Facts highlighted from logistics matrix selection. */
  highlightedFactIds?: string[];
  onFactIconClick?: (factId: string) => void;
  onPinnedCoordUpdate?: (factId: string, coord: [number, number]) => void;
  layerMode?: MapLayerMode;
  simElapsedMs?: number;
};

export function SituationalMap({
  facts,
  tracks,
  selectedTrackId,
  focusFactId,
  focusNonce,
  highlightedFactIds = [],
  onFactIconClick,
  onPinnedCoordUpdate,
  layerMode = "main",
  simElapsedMs = 0,
}: SituationalMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const activePopupRef = useRef<maplibregl.Popup | null>(null);
  const onFactIconClickRef = useRef(onFactIconClick);
  const onPinnedCoordUpdateRef = useRef(onPinnedCoordUpdate);
  const trackInteractionsBoundRef = useRef(false);
  const hasAutoFramedRef = useRef(false);
  const lastHandledFocusNonceRef = useRef<number | undefined>(undefined);

  onFactIconClickRef.current = onFactIconClick;
  onPinnedCoordUpdateRef.current = onPinnedCoordUpdate;
  const [selectedDomains, setSelectedDomains] = useState<string[]>([]);
  const [mapTracksReady, setMapTracksReady] = useState(false);
  const sensorFootprints = useMemo(() => collectSensorFootprints(facts), [facts]);
  const points = useMemo(
    () => buildFactPoints(facts, simElapsedMs, sensorFootprints),
    [facts, simElapsedMs, sensorFootprints]
  );
  const availableDomains = useMemo(
    () => Array.from(new Set(points.map((point) => point.domain))),
    [points]
  );
  const activeDomains = useMemo(() => {
    if (availableDomains.length === 0) return [];
    const next = selectedDomains.filter((domain) =>
      availableDomains.includes(domain)
    );
    return next.length > 0 ? next : availableDomains;
  }, [availableDomains, selectedDomains]);

  const domainFilteredPoints = useMemo(
    () =>
      points.filter(
        (point) =>
          activeDomains.length === 0 || activeDomains.includes(point.domain)
      ),
    [points, activeDomains]
  );

  const visiblePoints = useMemo(() => {
    let scoped = domainFilteredPoints;
    if (layerMode === "threats") {
      scoped = scoped.filter((point) => point.kind === "threat");
    } else if (layerMode === "sensors") {
      scoped = scoped.filter((point) => point.kind === "sensor");
    }
    return scoped;
  }, [domainFilteredPoints, layerMode]);

  const factsKey = useMemo(
    () => facts.map((fact) => `${fact.id}:${fact.coordinates?.lat ?? ""}:${fact.coordinates?.lng ?? ""}`).join("|"),
    [facts]
  );

  useEffect(() => {
    hasAutoFramedRef.current = false;
  }, [factsKey]);
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    if (MAP_STYLE_MODE === "terrain-pmtiles" && !pmtilesProtocolRegistered) {
      maplibregl.addProtocol("pmtiles", protocol.tile);
      pmtilesProtocolRegistered = true;
    }

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style:
        MAP_STYLE_MODE === "terrain-pmtiles"
          ? terrainPmtilesStyle()
          : MAP_STYLE_MODE === "osm-light"
            ? LIGHT_OSM_STYLE
            : DARK_OSM_STYLE,
      center: PORT_A_CENTER,
      zoom: 9.5,
      maxBounds: TAIWAN_MAX_BOUNDS,
      minZoom: 6,
      attributionControl: false,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");
    mapRef.current = map;

    const onLoad = () => {
      void ensureOperationalLayers(map).then(() => setMapTracksReady(true));
    };
    if (map.isStyleLoaded()) onLoad();
    else map.once("load", onLoad);

    const resizeObserver = new ResizeObserver(() => {
      // MapLibre needs an explicit resize when its container changes size
      map.resize();
    });
    resizeObserver.observe(mapContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      activePopupRef.current?.remove();
      activePopupRef.current = null;
      map.remove();
      mapRef.current = null;
      trackInteractionsBoundRef.current = false;
      wargameIconsRegistered = false;
      setMapTracksReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapTracksReady || !map?.getLayer("track-icons") || trackInteractionsBoundRef.current) {
      return;
    }
    trackInteractionsBoundRef.current = true;

    map.on("click", "track-icons", (event) => {
      const feature = event.features?.[0];
      const factId = feature?.properties?.factId;
      if (factId) onFactIconClickRef.current?.(String(factId));
    });
    map.on("mouseenter", "track-icons", () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "track-icons", () => {
      map.getCanvas().style.cursor = "";
    });
  }, [mapTracksReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapTracksReady || !map?.getSource("tracks-points")) return;

    const pointsSource = map.getSource("tracks-points") as maplibregl.GeoJSONSource;
    const ringsSource = map.getSource("tracks-rings") as maplibregl.GeoJSONSource;
    pointsSource.setData(
      buildTracksPointGeoJson(visiblePoints, selectedTrackId, highlightedFactIds)
    );
    ringsSource.setData(
      buildTrackRingPolygonsGeoJson(visiblePoints, {
        includeFixedSites: layerMode === "sensors",
      })
    );

    if (!hasAutoFramedRef.current) {
      const theaterBounds = new maplibregl.LngLatBounds(
        [TAIWAN_BOUNDS.minLng, TAIWAN_BOUNDS.minLat],
        [TAIWAN_BOUNDS.maxLng, TAIWAN_BOUNDS.maxLat]
      );
      map.fitBounds(theaterBounds, { padding: 40, maxZoom: 10, duration: 500 });
      hasAutoFramedRef.current = true;
    }

    syncPinnedTrackPopup(
      map,
      visiblePoints,
      selectedTrackId,
      activePopupRef,
      onPinnedCoordUpdateRef
    );
  }, [visiblePoints, selectedTrackId, highlightedFactIds, simElapsedMs, layerMode, mapTracksReady]);

  useEffect(() => {
    if (!focusFactId) return;
    if (focusNonce === undefined) return;
    if (lastHandledFocusNonceRef.current === focusNonce) return;

    const map = mapRef.current;
    const point = visiblePoints.find((p) => p.factId === focusFactId);
    if (!map || !point) return;
    lastHandledFocusNonceRef.current = focusNonce;

    map.easeTo({
      center: point.coord,
      zoom: map.getZoom(),
      duration: 550,
      essential: true,
    });
    syncPinnedTrackPopup(
      map,
      visiblePoints,
      focusFactId,
      activePopupRef,
      onPinnedCoordUpdateRef
    );
  }, [focusFactId, focusNonce, visiblePoints]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("zone-blue-fill")) return;
    applyLayerVisibility(map, layerMode);
  }, [layerMode]);

  const toggleDomain = (domain: string) => {
    setSelectedDomains((prev) =>
      prev.includes(domain)
        ? prev.filter((value) => value !== domain)
        : [...prev, domain]
    );
  };

  const contactCount = tracks?.length ?? visiblePoints.length;
  const layerHint =
    layerMode === "sensors"
      ? "Light blue rings: notional radar/SIGINT coverage (~18 km) at fixed sites."
      : layerMode === "zones"
        ? "Large circles: mission surveillance / exclusion / patrol areas (not individual sensors)."
        : layerMode === "threats"
          ? "Showing threat-class contacts only."
          : "Blue = friendly sensor. Red = threat (dashed ring when in sensor coverage). Green = other track.";

  return (
    <div className={styles.wrapper}>
      <div ref={mapContainerRef} className={styles.map} />
      <div className={styles.mapChrome} />
      <div className={styles.mapOverlayLeft}>
        <div className={styles.overlayTitle}>Threat Situation</div>
        <div className={styles.overlayBody}>
          <span>Active contacts: {contactCount}</span>
          <span>
            Icons on map: {visiblePoints.length} · In coverage:{" "}
            {visiblePoints.filter((p) => p.inSensorRange || p.kind === "sensor").length} · Critical:{" "}
            {facts.filter((fact) => fact.severity === "critical").length} · High:{" "}
            {facts.filter((fact) => fact.severity === "high").length}
          </span>
          <span>
            Dominant domain:{" "}
            {availableDomains.length > 0 ? domainLabel(availableDomains[0] ?? "signals") : "Pending"}
          </span>
          <span className={styles.layerHint}>{layerHint}</span>
        </div>
      </div>
      <div className={styles.mapOverlayRight}>
        <div className={styles.overlayTitle}>AI Detection</div>
        <div className={styles.overlayBody}>
          {visiblePoints.slice(0, 3).map((point, index) => (
            <span key={`${point.title}-${index}`}>
              {point.kind.toUpperCase()} · {point.domain.toUpperCase()}
            </span>
          ))}
          {visiblePoints.length === 0 && <span>No contacts.</span>}
        </div>
      </div>
      {MAP_STYLE_MODE === "terrain-pmtiles" && (
        <div className={styles.modeHint}>Terrain mode: PMTiles (self-hosted)</div>
      )}
      {availableDomains.length > 0 && (
        <div className={styles.domainFilters}>
          {availableDomains.map((domain) => {
            const active = activeDomains.includes(domain);
            return (
              <button
                key={domain}
                type="button"
                className={active ? styles.domainToggleActive : styles.domainToggle}
                onClick={() => toggleDomain(domain)}
              >
                {domainLabel(domain)}
              </button>
            );
          })}
        </div>
      )}
      <div className={styles.legend}>
        <span>
          <i className={`${styles.legendDot} ${styles["marker-threat"]}`} /> Threat contact
        </span>
        <span>
          <i className={`${styles.legendDot} ${styles["marker-sensor"]}`} /> Sensor / SIGINT
        </span>
        <span>
          <i className={`${styles.legendDot} ${styles["marker-friendly"]}`} /> Other contact
        </span>
        <span>
          <i className={`${styles.legendDot} ${styles.legendSensorWire}`} /> Sensor footprint
        </span>
        <span>
          <i className={`${styles.legendDot} ${styles.legendDetectRing}`} /> Detection ring
        </span>
        {layerMode === "sensors" && (
          <span>
            <i className={`${styles.legendDot} ${styles.legendSensorCoverage}`} /> Radar coverage
          </span>
        )}
        {layerMode === "zones" && (
          <>
            <span>
              <i className={`${styles.legendDot} ${styles.legendZoneBlue}`} /> Surveillance zone
            </span>
            <span>
              <i className={`${styles.legendDot} ${styles.legendZoneRed}`} /> Exclusion zone
            </span>
            <span>
              <i className={`${styles.legendDot} ${styles.legendZonePatrol}`} /> Patrol zone
            </span>
          </>
        )}
      </div>
    </div>
  );
}

type FactPoint = {
  coord: [number, number];
  title: string;
  subtitle: string;
  domain: string;
  kind: "threat" | "sensor" | "friendly";
  factId: string;
  inSensorRange: boolean;
  detected: boolean;
  detectingSensorName?: string;
  moving: boolean;
  headingDeg: number;
  speedKts: number;
};

function buildFactPoints(
  facts: ObservedFact[],
  simElapsedMs: number,
  sensors: SensorFootprint[]
): FactPoint[] {
  return facts.map((fact, index) => {
    let coord = factToLngLat(fact, index);

    const kinematics = contactKinematics(fact.id);
    const baseCoord = coord;
    coord = clampLngLatToTheater(
      offsetCoordByMotion(baseCoord, kinematics, simElapsedMs)
    );

    const kind = classifyPoint(fact);
    const inSensorRange = kind === "sensor" || isWithinSensorRange(baseCoord, sensors);
    const sensor = inSensorRange && kind !== "sensor" ? nearestSensor(baseCoord, sensors) : undefined;

    return {
      coord,
      title: `${fact.domain.toUpperCase()} · ${fact.event}`,
      subtitle: `${fact.time}${fact.location ? ` · ${fact.location}` : ""}`,
      domain: fact.domain,
      kind,
      factId: fact.id,
      inSensorRange,
      detected: kind === "threat" && Boolean(sensor),
      detectingSensorName: sensor?.name,
      moving: kinematics.moving,
      headingDeg: kinematics.headingDeg,
      speedKts: kinematics.speedKts,
    };
  });
}

function classifyPoint(fact: ObservedFact): "threat" | "sensor" | "friendly" {
  if (isSensorEntityFact(fact)) return "sensor";
  if (
    fact.domain === "UAS" ||
    fact.domain === "maritime" ||
    fact.domain === "air" ||
    fact.severity === "high" ||
    fact.severity === "critical"
  ) {
    return "threat";
  }
  return "friendly";
}

function domainLabel(domain: string): string {
  if (domain === "UAS") return "UAS";
  if (domain === "cyber") return "Cyber";
  if (domain === "maritime") return "Maritime";
  if (domain === "information") return "Information";
  if (domain === "signals") return "Signals";
  return domain;
}

const WARGAME_ICON_URLS = {
  uav_drone: new URL("../../../wargame_icon_pack/svg/uav_drone.svg", import.meta.url).href,
  fighter_jet: new URL("../../../wargame_icon_pack/svg/fighter_jet.svg", import.meta.url).href,
  strike_aircraft: new URL("../../../wargame_icon_pack/svg/strike_aircraft.svg", import.meta.url).href,
  surface_warship: new URL("../../../wargame_icon_pack/svg/surface_warship.svg", import.meta.url).href,
  missile_boat: new URL("../../../wargame_icon_pack/svg/missile_boat.svg", import.meta.url).href,
  submarine: new URL("../../../wargame_icon_pack/svg/submarine.svg", import.meta.url).href,
  radar: new URL("../../../wargame_icon_pack/svg/radar.svg", import.meta.url).href,
  passive_sensor: new URL("../../../wargame_icon_pack/svg/passive_sensor.svg", import.meta.url).href,
  cyber_attack: new URL("../../../wargame_icon_pack/svg/cyber_attack.svg", import.meta.url).href,
  command_node: new URL("../../../wargame_icon_pack/svg/command_node.svg", import.meta.url).href,
  logistics_depot: new URL("../../../wargame_icon_pack/svg/logistics_depot.svg", import.meta.url).href,
  satellite: new URL("../../../wargame_icon_pack/svg/satellite.svg", import.meta.url).href,
  civilian_marker: new URL("../../../wargame_icon_pack/svg/civilian_marker.svg", import.meta.url).href,
  missile_inbound: new URL("../../../wargame_icon_pack/svg/missile_inbound.svg", import.meta.url).href,
  unknown_contact: new URL("../../../wargame_icon_pack/svg/unknown_contact.svg", import.meta.url).href,
} as const;

function iconKeyForPoint(point: FactPoint): keyof typeof WARGAME_ICON_URLS {
  const title = point.title.toLowerCase();
  if (title.includes("submarine")) return "submarine";
  if (title.includes("missile")) return "missile_inbound";
  if (point.domain === "UAS") return "uav_drone";
  if (point.domain === "air") return point.kind === "threat" ? "strike_aircraft" : "fighter_jet";
  if (point.domain === "maritime") return point.kind === "threat" ? "missile_boat" : "surface_warship";
  if (point.domain === "signals") return point.kind === "sensor" ? "radar" : "passive_sensor";
  if (point.domain === "cyber") return "cyber_attack";
  if (point.domain === "space") return "satellite";
  if (point.domain === "logistics") return "logistics_depot";
  if (point.domain === "information") return "civilian_marker";
  if (point.domain === "ground") return "command_node";
  return "unknown_contact";
}

function buildTracksPointGeoJson(
  points: FactPoint[],
  selectedTrackId?: string,
  highlightedFactIds: string[] = []
): GeoJSON.FeatureCollection {
  const highlightSet = new Set(highlightedFactIds);
  return {
    type: "FeatureCollection",
    features: points.map((point) => ({
      type: "Feature",
      properties: {
        factId: point.factId,
        iconKey: iconKeyForPoint(point),
        kind: point.kind,
        selected: point.factId === selectedTrackId,
        logisticsLinked: highlightSet.has(point.factId) ? 1 : 0,
        dimmed: !point.inSensorRange && point.kind !== "sensor",
        headingDeg: point.headingDeg,
        moving: point.moving ? 1 : 0,
        title: point.title,
        subtitle: point.subtitle,
        speedKts: point.speedKts,
        detectingSensorName: point.detectingSensorName ?? "",
        detected: point.detected ? 1 : 0,
      },
      geometry: { type: "Point", coordinates: point.coord },
    })),
  };
}

function trackPopupHtml(point: FactPoint): string {
  const motionLine =
    point.moving && point.speedKts
      ? `<div class="${styles.popupSubtitle}">HDG ${point.headingDeg}° · ${Math.round(point.speedKts)} kts</div>`
      : "";
  const detectLine =
    point.kind === "threat" && point.detected
      ? `<div class="${styles.popupSubtitle}">Detected by ${escapeHtml(point.detectingSensorName ?? "sensor net")}</div>`
      : "";
  const coordLine = `<div class="${styles.popupCoord}">${escapeHtml(formatCoordLabel(point.coord))}</div>`;
  return `<div class="${styles.popupBody}">
    <div class="${styles.popupTitle}">${escapeHtml(point.title)}</div>
    <div class="${styles.popupSubtitle}">${escapeHtml(point.subtitle)}</div>
    ${coordLine}
    ${motionLine}
    ${detectLine}
  </div>`;
}

function syncPinnedTrackPopup(
  map: maplibregl.Map,
  points: FactPoint[],
  pinnedFactId: string | undefined,
  popupRef: React.MutableRefObject<maplibregl.Popup | null>,
  onCoordUpdate?: React.MutableRefObject<
    ((factId: string, coord: [number, number]) => void) | undefined
  >
): void {
  if (!pinnedFactId) {
    popupRef.current?.remove();
    popupRef.current = null;
    return;
  }

  const point = points.find((p) => p.factId === pinnedFactId);
  if (!point) {
    popupRef.current?.remove();
    popupRef.current = null;
    return;
  }

  onCoordUpdate?.current?.(point.factId, point.coord);

  const html = trackPopupHtml(point);
  const lngLat: [number, number] = [point.coord[0], point.coord[1]];

  if (!popupRef.current) {
    popupRef.current = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      closeOnMove: false,
      anchor: "bottom",
      offset: [0, -16],
      className: "situational-popup-dark situational-popup-pinned",
      maxWidth: "300px",
    })
      .setLngLat(lngLat)
      .setHTML(html)
      .addTo(map);
    return;
  }

  popupRef.current.setLngLat(lngLat).setHTML(html);
}

let wargameIconsRegistered = false;

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load icon: ${url}`));
    image.src = url;
  });
}

async function registerWargameIcons(map: maplibregl.Map): Promise<void> {
  if (wargameIconsRegistered) return;
  await Promise.all(
    Object.entries(WARGAME_ICON_URLS).map(async ([key, url]) => {
      const imageId = `wg-${key}`;
      if (map.hasImage(imageId)) return;
      const image = await loadImageElement(url);
      map.addImage(imageId, image, { pixelRatio: 2 });
    })
  );
  wargameIconsRegistered = true;
}

function factPointFromFeature(feature: GeoJSON.Feature): FactPoint | undefined {
  const props = feature.properties;
  if (!props || feature.geometry.type !== "Point") return undefined;
  return {
    coord: feature.geometry.coordinates as [number, number],
    factId: String(props.factId),
    title: String(props.title),
    subtitle: String(props.subtitle),
    domain: "",
    kind: props.kind as FactPoint["kind"],
    inSensorRange: !props.dimmed,
    detected: Number(props.detected) === 1,
    detectingSensorName: String(props.detectingSensorName || ""),
    moving: Number(props.moving) === 1,
    headingDeg: Number(props.headingDeg),
    speedKts: Number(props.speedKts),
  };
}

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function ensureOperationalLayers(map: maplibregl.Map) {
  if (map.getSource("operational-zones")) return;

  const zones: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { kind: "surveillance" },
        geometry: { type: "Polygon", coordinates: [circleRing(PORT_A_CENTER, 45)] },
      },
      {
        type: "Feature",
        properties: { kind: "exclusion" },
        geometry: { type: "Polygon", coordinates: [circleRing([120.65, 24.35], 35)] },
      },
      {
        type: "Feature",
        properties: { kind: "patrol" },
        geometry: { type: "Polygon", coordinates: [circleRing([121.2, 24.8], 28)] },
      },
    ],
  };

  const sensorCoverage: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: FIXED_SENSOR_SITES.map((site) => ({
      type: "Feature",
      properties: { name: site.name },
      geometry: { type: "Polygon", coordinates: [circleRing(site.coord, site.radiusKm)] },
    })),
  };

  const sensorSites: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: FIXED_SENSOR_SITES.map((site) => ({
      type: "Feature",
      properties: { name: site.name },
      geometry: { type: "Point", coordinates: site.coord },
    })),
  };

  map.addSource("operational-zones", { type: "geojson", data: zones });
  map.addSource("sensor-coverage", { type: "geojson", data: sensorCoverage });
  map.addSource("sensor-sites", { type: "geojson", data: sensorSites });
  map.addSource("tracks-points", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addSource("tracks-rings", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addLayer({
    id: "zone-blue-fill",
    type: "fill",
    source: "operational-zones",
    filter: ["==", ["get", "kind"], "surveillance"],
    paint: { "fill-color": "#38bdf8", "fill-opacity": 0.12 },
  });
  map.addLayer({
    id: "zone-blue-line",
    type: "line",
    source: "operational-zones",
    filter: ["==", ["get", "kind"], "surveillance"],
    paint: { "line-color": "#38bdf8", "line-opacity": 0.55, "line-width": 1.5 },
  });
  map.addLayer({
    id: "zone-red-fill",
    type: "fill",
    source: "operational-zones",
    filter: ["==", ["get", "kind"], "exclusion"],
    paint: { "fill-color": "#ef4444", "fill-opacity": 0.14 },
  });
  map.addLayer({
    id: "zone-red-line",
    type: "line",
    source: "operational-zones",
    filter: ["==", ["get", "kind"], "exclusion"],
    paint: {
      "line-color": "#ef4444",
      "line-opacity": 0.7,
      "line-width": 1.5,
      "line-dasharray": [2, 2],
    },
  });
  map.addLayer({
    id: "zone-patrol-fill",
    type: "fill",
    source: "operational-zones",
    filter: ["==", ["get", "kind"], "patrol"],
    paint: { "fill-color": "#22c55e", "fill-opacity": 0.1 },
  });
  map.addLayer({
    id: "zone-patrol-line",
    type: "line",
    source: "operational-zones",
    filter: ["==", ["get", "kind"], "patrol"],
    paint: { "line-color": "#22c55e", "line-opacity": 0.55, "line-width": 1.5 },
  });
  map.addLayer({
    id: "sensor-coverage-fill",
    type: "fill",
    source: "sensor-coverage",
    paint: { "fill-color": "#67b6ff", "fill-opacity": 0.18 },
  });
  map.addLayer({
    id: "sensor-coverage-line",
    type: "line",
    source: "sensor-coverage",
    paint: { "line-color": "#67b6ff", "line-opacity": 0.45, "line-width": 1 },
  });
  map.addLayer({
    id: "sensor-sites-circle",
    type: "circle",
    source: "sensor-sites",
    paint: {
      "circle-radius": 7,
      "circle-color": "#67b6ff",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: "track-ring-sensor-line",
    type: "line",
    source: "tracks-rings",
    filter: ["in", ["get", "ringType"], ["literal", ["sensor", "sensor-site"]]],
    paint: {
      "line-color": "#67b6ff",
      "line-opacity": 0.9,
      "line-width": 1.5,
    },
  });
  map.addLayer({
    id: "track-ring-detection-line",
    type: "line",
    source: "tracks-rings",
    filter: ["==", ["get", "ringType"], "detection"],
    paint: {
      "line-color": "#93c5fd",
      "line-opacity": 0.75,
      "line-width": 1.25,
      "line-dasharray": [2, 2],
    },
  });
  map.addLayer({
    id: "track-halo",
    type: "circle",
    source: "tracks-points",
    paint: {
      "circle-radius": ["case", ["boolean", ["get", "selected"], false], 14, 12],
      "circle-color": [
        "match",
        ["get", "kind"],
        "threat",
        "rgba(127, 29, 29, 0.85)",
        "sensor",
        "rgba(30, 58, 138, 0.85)",
        "rgba(20, 83, 45, 0.85)",
      ],
      "circle-stroke-color": [
        "match",
        ["get", "kind"],
        "threat",
        "#f87171",
        "sensor",
        "#67b6ff",
        "#5fd68b",
      ],
      "circle-stroke-width": 2,
      "circle-opacity": ["case", ["boolean", ["get", "dimmed"], false], 0.4, 0.92],
    },
  });

  await registerWargameIcons(map);

  map.addLayer({
    id: "track-icons",
    type: "symbol",
    source: "tracks-points",
    layout: {
      "icon-image": ["concat", "wg-", ["get", "iconKey"]],
      "icon-size": [
        "case",
        ["==", ["get", "logisticsLinked"], 1],
        0.56,
        ["boolean", ["get", "selected"], false],
        0.5,
        0.44,
      ],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-rotate": [
        "case",
        ["==", ["get", "moving"], 1],
        ["get", "headingDeg"],
        0,
      ],
      "icon-rotation-alignment": "map",
      "icon-pitch-alignment": "map",
    },
  });

  applyLayerVisibility(map, "main");
}

function setLayerVisible(map: maplibregl.Map, layerId: string, visible: boolean) {
  if (!map.getLayer(layerId)) return;
  map.setLayoutProperty(layerId, "visibility", visible ? "visible" : "none");
}

function applyLayerVisibility(map: maplibregl.Map, mode: MapLayerMode) {
  const showZones = mode === "zones";
  const showSensors = mode === "sensors";
  const showTrackRings = mode === "main" || showSensors;

  setLayerVisible(map, "zone-blue-fill", showZones);
  setLayerVisible(map, "zone-blue-line", showZones);
  setLayerVisible(map, "zone-red-fill", showZones);
  setLayerVisible(map, "zone-red-line", showZones);
  setLayerVisible(map, "zone-patrol-fill", showZones);
  setLayerVisible(map, "zone-patrol-line", showZones);
  setLayerVisible(map, "sensor-coverage-fill", showSensors);
  setLayerVisible(map, "sensor-coverage-line", showSensors);
  setLayerVisible(map, "sensor-sites-circle", showSensors);
  setLayerVisible(map, "track-ring-sensor-line", showTrackRings);
  setLayerVisible(map, "track-ring-detection-line", mode === "main");
  setLayerVisible(map, "track-halo", true);
  setLayerVisible(map, "track-icons", true);
}

