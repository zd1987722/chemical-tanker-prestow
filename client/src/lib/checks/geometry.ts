import { DEMO_SHIP } from "../hull";

export interface GeometryCheck {
  id: string;
  name: string;
  value: number;
  limit: number;
  unit: string;
  pass: boolean;
  note?: string;
}

export interface GeometryFloating {
  draftMid: number;
  draftAft: number;
  draftFwd: number;
}

export function visibilityCheck(floating: GeometryFloating): GeometryCheck {
  const { bridgeX, bridgeEyeZ, forecastleTopZ } = DEMO_SHIP.geometry;
  const bowTopX = DEMO_SHIP.forecastle.x2;
  const sightSlope = (forecastleTopZ - bridgeEyeZ) / (bowTopX - bridgeX);
  const waterSlope =
    (floating.draftFwd - floating.draftAft) / DEMO_SHIP.hull.lbp;
  const intersectionX =
    (floating.draftAft - bridgeEyeZ + sightSlope * bridgeX) /
    (sightSlope - waterSlope);
  const value = intersectionX - DEMO_SHIP.hull.lbp;
  const limit = Math.min(2 * DEMO_SHIP.hull.lbp, 500);
  return {
    id: "visibility",
    name: "驾驶台视线盲区",
    value,
    limit,
    unit: "m",
    pass: value <= limit,
    note: "视线经艏楼顶与艏艉吃水斜水线的交点至艏垂线距离",
  };
}

export function propellerImmersion(floating: GeometryFloating): GeometryCheck {
  const { z, diameter } = DEMO_SHIP.geometry.propeller;
  const value = ((floating.draftAft - (z - diameter / 2)) / diameter) * 100;
  return {
    id: "propeller-immersion",
    name: "螺旋桨浸没率",
    value,
    limit: 100,
    unit: "%",
    pass: value >= 100,
    ...(value >= 80 && value < 100
      ? { note: "达到 80%，但螺旋桨尚未全浸" }
      : {}),
  };
}

export function forwardDraftCheck(floating: GeometryFloating): GeometryCheck {
  const limit = DEMO_SHIP.geometry.minForwardDraft;
  return {
    id: "forward-draft",
    name: "最小艏吃水",
    value: floating.draftFwd,
    limit,
    unit: "m",
    pass: floating.draftFwd >= limit,
    note: "演示自拟要求：0.02 × LBP + 2",
  };
}

export function airDraft(floating: GeometryFloating): GeometryCheck {
  return {
    id: "air-draft",
    name: "空高",
    value: DEMO_SHIP.geometry.mastTopZ - floating.draftMid,
    limit: Number.POSITIVE_INFINITY,
    unit: "m",
    pass: true,
    note: "仅显示；未设置桥梁净空限值",
  };
}

export function geometryChecks(floating: GeometryFloating): GeometryCheck[] {
  return [
    visibilityCheck(floating),
    propellerImmersion(floating),
    forwardDraftCheck(floating),
    airDraft(floating),
  ];
}
