import { DEFAULT_HULL_PARAMS } from "./hull-form";
import type { BoxDef, CompartmentDef, DemoShipDef } from "./types";

const HALF_BREADTH = DEFAULT_HULL_PARAMS.breadth / 2;
const INNER_SIDE = HALF_BREADTH - 2.3;

function cargoPair(station: number, x1: number, x2: number): CompartmentDef[] {
  const name = station === 10 ? "SLOP TK" : `NO.${station} C.O.T`;
  return [
    { id: `${station}P`, name: `${name} (P)`, kind: "cargo", boxes: [{ x1, x2, y1: -INNER_SIDE, y2: 0, z1: 2.2, z2: 19 }], ullageRef: 20 },
    { id: `${station}S`, name: `${name} (S)`, kind: "cargo", boxes: [{ x1, x2, y1: 0, y2: INNER_SIDE, z1: 2.2, z2: 19 }], ullageRef: 20 },
  ];
}

function ballastPair(station: number, x1: number, x2: number): CompartmentDef[] {
  const boxes = (side: "P" | "S"): BoxDef[] => side === "P"
    ? [
        { x1, x2, y1: -HALF_BREADTH, y2: 0, z1: 0, z2: 2.2 },
        { x1, x2, y1: -HALF_BREADTH, y2: -INNER_SIDE, z1: 2.2, z2: 19 },
      ]
    : [
        { x1, x2, y1: 0, y2: HALF_BREADTH, z1: 0, z2: 2.2 },
        { x1, x2, y1: INNER_SIDE, y2: HALF_BREADTH, z1: 2.2, z2: 19 },
      ];
  return [
    { id: `WB${station}P`, name: `WB${station} (P)`, kind: "ballast", boxes: boxes("P") },
    { id: `WB${station}S`, name: `WB${station} (S)`, kind: "ballast", boxes: boxes("S") },
  ];
}

function sideTankPair(
  id: string,
  name: string,
  kind: "fuel" | "fresh",
  x1: number,
  x2: number,
  yInner: number,
  yOuter: number,
  z1: number,
  z2: number,
): CompartmentDef[] {
  return [
    { id: `${id}P`, name: `${name} (P)`, kind, boxes: [{ x1, x2, y1: -yOuter, y2: -yInner, z1, z2 }] },
    { id: `${id}S`, name: `${name} (S)`, kind, boxes: [{ x1, x2, y1: yInner, y2: yOuter, z1, z2 }] },
  ];
}

const compartments: CompartmentDef[] = [
  ...cargoPair(1, 150, 161),
  ...cargoPair(2, 129, 142),
  ...cargoPair(3, 115.8, 129),
  ...cargoPair(4, 102.6, 115.8),
  ...cargoPair(5, 89.4, 102.6),
  ...cargoPair(6, 76.2, 89.4),
  ...cargoPair(7, 63, 76.2),
  ...cargoPair(8, 50, 63),
  ...cargoPair(9, 38.5, 50),
  ...cargoPair(10, 35.5, 38.5),
  ...ballastPair(1, 129, 161),
  ...ballastPair(2, 102.6, 129),
  ...ballastPair(3, 76.2, 102.6),
  ...ballastPair(4, 50, 76.2),
  ...ballastPair(5, 33, 50),
  { id: "FPT", name: "FORE PEAK TANK", kind: "ballast", boxes: [{ x1: 164, x2: 181, y1: -HALF_BREADTH, y2: HALF_BREADTH, z1: 0, z2: 19 }] },
  { id: "APT", name: "AFT PEAK TANK", kind: "ballast", boxes: [{ x1: -6, x2: 8, y1: -HALF_BREADTH, y2: HALF_BREADTH, z1: 0, z2: 19 }] },
  { id: "STG", name: "STEERING GEAR ROOM", kind: "void", boxes: [{ x1: 8, x2: 12, y1: -HALF_BREADTH, y2: HALF_BREADTH, z1: 0, z2: 19 }] },
  ...sideTankPair("HFO1", "HFO TK NO.1", "fuel", 20, 33, 3, 12, 2.2, 9),
  ...sideTankPair("HFO2", "HFO TK NO.2", "fuel", 14, 20, 3, 11, 2.2, 9),
  ...sideTankPair("DO", "DO TK", "fuel", 8, 14, 1.5, 8, 2.2, 8),
  ...sideTankPair("FW", "FW TK", "fresh", 8, 14, 1.5, 8, 8, 14),
  { id: "ERDB", name: "ENGINE ROOM DOUBLE BOTTOM", kind: "void", boxes: [{ x1: 12, x2: 33, y1: -12, y2: 12, z1: 0, z2: 2.2 }] },
  {
    id: "ER",
    name: "ENGINE ROOM",
    kind: "void",
    boxes: [
      { x1: 14, x2: 33, y1: -3, y2: 3, z1: 2.2, z2: 19 },
      { x1: 14, x2: 33, y1: -12, y2: -3, z1: 9, z2: 19 },
      { x1: 14, x2: 33, y1: 3, y2: 12, z1: 9, z2: 19 },
      { x1: 12, x2: 14, y1: -1.5, y2: 1.5, z1: 2.2, z2: 14 },
      { x1: 12, x2: 14, y1: -12, y2: 12, z1: 14, z2: 19 },
    ],
  },
];

export const DEMO_SHIP: DemoShipDef = {
  id: "demo-mr",
  label: "虚构船 · 演示",
  hull: DEFAULT_HULL_PARAMS,
  designDraft: 12.2,
  scantlingDraft: 13,
  frameSpacing: 0.8,
  doubleBottom: 2.2,
  doubleSide: 2.3,
  compartments,
  lightship: [
    { name: "船体钢料", weight: 8200, x1: -6, x2: 181, vcg: 10.5, dist: "hull" },
    { name: "机舱机械", weight: 1700, x1: 8, x2: 33, vcg: 6.5, dist: "uniform" },
    { name: "上层建筑", weight: 1100, x1: 15, x2: 33, vcg: 25, dist: "uniform" },
    { name: "货泵与管系", weight: 500, x1: 33, x2: 161, vcg: 19.5, dist: "uniform" },
    { name: "艏楼与锚机", weight: 250, x1: 161, x2: 181, vcg: 21, dist: "uniform" },
    { name: "艉部设备与舵", weight: 150, x1: -6, x2: 8, vcg: 9, dist: "uniform" },
  ],
  allowables: [
    { x: 0, bmHogSea: 0, bmSagSea: 0, bmHogHar: 0, bmSagHar: 0, sfSea: 0, sfHar: 0 },
    { x: 0.5, bmHogSea: 12000, bmSagSea: -10000, bmHogHar: 15000, bmSagHar: -13000, sfSea: 5000, sfHar: 6000 },
    { x: 8, bmHogSea: 231000, bmSagSea: -186000, bmHogHar: 289000, bmSagHar: -233000, sfSea: 18000, sfHar: 20000 },
    { x: 20, bmHogSea: 360000, bmSagSea: -288000, bmHogHar: 450000, bmSagHar: -360000, sfSea: 29000, sfHar: 32000 },
    { x: 35, bmHogSea: 1635000, bmSagSea: -1316000, bmHogHar: 2044000, bmSagHar: -1645000, sfSea: 54000, sfHar: 59000 },
    { x: 50, bmHogSea: 1635000, bmSagSea: -1316000, bmHogHar: 2044000, bmSagHar: -1645000, sfSea: 63000, sfHar: 69000 },
    { x: 80, bmHogSea: 1923000, bmSagSea: -1539000, bmHogHar: 2404000, bmSagHar: -1924000, sfSea: 54000, sfHar: 59000 },
    { x: 95, bmHogSea: 1910000, bmSagSea: -1548000, bmHogHar: 2388000, bmSagHar: -1935000, sfSea: 54000, sfHar: 59000 },
    { x: 140, bmHogSea: 1635000, bmSagSea: -1316000, bmHogHar: 2044000, bmSagHar: -1645000, sfSea: 54000, sfHar: 59000 },
    { x: 155, bmHogSea: 522000, bmSagSea: -418000, bmHogHar: 653000, bmSagHar: -523000, sfSea: 31000, sfHar: 34000 },
    { x: 164, bmHogSea: 227000, bmSagSea: -182000, bmHogHar: 284000, bmSagHar: -228000, sfSea: 35000, sfHar: 39000 },
    { x: 167, bmHogSea: 231000, bmSagSea: -186000, bmHogHar: 289000, bmSagHar: -233000, sfSea: 26000, sfHar: 29000 },
    { x: 174.5, bmHogSea: 84000, bmSagSea: -68000, bmHogHar: 105000, bmSagHar: -85000, sfSea: 8000, sfHar: 9000 },
    { x: 175, bmHogSea: 0, bmSagSea: 0, bmHogHar: 0, bmSagHar: 0, sfSea: 0, sfHar: 0 },
  ],
  deckhouse: { x1: 15, x2: 33, height: 15 },
  forecastle: { x1: 161, x2: 181, height: 3 },
  geometry: {
    bridgeX: 33,
    bridgeEyeZ: 35.8,
    forecastleTopZ: 22,
    propeller: { x: 3.5, z: 3.6, diameter: 6.6 },
    mastTopZ: 43,
    minForwardDraft: 5.5,
  },
  openings: [
    { name: "机舱通风筒 (P)", x: 28, y: -13, z: 22 },
    { name: "机舱通风筒 (S)", x: 28, y: 13, z: 22 },
    { name: "居住区门 (P)", x: 33, y: -11, z: 20.2 },
    { name: "居住区门 (S)", x: 33, y: 11, z: 20.2 },
    { name: "货舱区通道口", x: 100, y: 0, z: 20.5 },
  ],
};
