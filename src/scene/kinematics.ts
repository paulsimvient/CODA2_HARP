/** Deterministic pseudo-random from string (stable per contact). */
export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type ContactKinematics = {
  moving: boolean;
  headingDeg: number;
  speedKts: number;
};

export function contactKinematics(factId: string): ContactKinematics {
  const h = hashString(factId);
  const moving = h % 5 !== 0;
  const headingDeg = h % 360;
  const speedKts = 12 + (hashString(`${factId}-spd`) % 48);
  return { moving, headingDeg, speedKts };
}

const MAX_DISPLAY_DRIFT_KM = 8;

/** Advance position along heading for sim-time (capped drift for display). */
export function offsetCoordByMotion(
  base: [number, number],
  kinematics: ContactKinematics,
  simElapsedMs: number
): [number, number] {
  if (!kinematics.moving || simElapsedMs <= 0) return base;
  const hours = simElapsedMs / (1000 * 60 * 60);
  const distanceKm = Math.min(kinematics.speedKts * 1.852 * hours, MAX_DISPLAY_DRIFT_KM);
  const [lng, lat] = base;
  const kmPerDegLat = 111;
  const kmPerDegLng = Math.max(40, 111 * Math.cos((lat * Math.PI) / 180));
  const rad = (kinematics.headingDeg * Math.PI) / 180;
  return [
    lng + (distanceKm * Math.sin(rad)) / kmPerDegLng,
    lat + (distanceKm * Math.cos(rad)) / kmPerDegLat,
  ];
}

export function formatSimElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `T+${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `T+${m}:${String(s).padStart(2, "0")}`;
}

export const SIM_TIME_SCALES = [1, 5, 15, 30, 60, 120, 300, 600, 1000] as const;
export type SimTimeScale = (typeof SIM_TIME_SCALES)[number];
