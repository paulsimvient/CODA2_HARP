export type WorldObjectKind = "uav" | "hostile-drone" | "asset";

export type WorldObject = {
  id: string;
  kind: WorldObjectKind;
  name: string;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  hp?: number;
  targetAssetId?: string;
  observable: boolean;
};

export type UavWorldState = {
  x: number;
  y: number;
};

export type AssetWorldState = {
  id: string;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
};

export type ThreatWorldState = {
  id: number;
  x: number;
  y: number;
  speed: number;
  targetAssetId: string;
};

export function buildWorldObjects(input: {
  uav: UavWorldState;
  assets: AssetWorldState[];
  threats: ThreatWorldState[];
}): WorldObject[] {
  const uavObject: WorldObject = {
    id: "blue-uav",
    kind: "uav",
    name: "UAV task group",
    x: input.uav.x,
    y: input.uav.y,
    observable: true,
  };

  const assets = input.assets.map((asset): WorldObject => ({
    id: asset.id,
    kind: "asset",
    name: asset.name,
    x: asset.x,
    y: asset.y,
    hp: asset.hp,
    observable: true,
  }));

  const threats = input.threats.map((threat): WorldObject => ({
    id: `threat-${threat.id}`,
    kind: "hostile-drone",
    name: "unidentified drone",
    x: threat.x,
    y: threat.y,
    targetAssetId: threat.targetAssetId,
    vx: threat.speed,
    observable: true,
  }));

  return [uavObject, ...assets, ...threats];
}
