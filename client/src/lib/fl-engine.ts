/**
 * 充装极限计算引擎(纯函数)—— CCS 2022 第 5 章 / IGC Code 15.4。
 *   LL    = FL × ρR / ρL      (FL = 0.98 固定)
 *   V_max = LL × V100
 *   W_max = FL × V100 × ρR    (与温度无关)
 * ρL 由温度-密度表【线性内插 ρ,再重算 LL】—— 规范禁止直接内插 LL 列。
 * 移植自 TankLimit(实测精度 ±0.001%)与设计稿 fl-data.js,口径一致。
 */

export const FL_COEFF = 0.98;

export interface TableRow {
  t: number; // ℃
  rho: number; // t/m³
}
export interface FlCargo {
  code: string;
  nameZh: string;
  nameEn: string;
  refTemp: number; // 基准温度 ℃(45)
  rhoR: number; // 基准密度 t/m³
  marvs: number | null; // MPa
  table: TableRow[];
}
export interface FlTank {
  tankNo: string;
  capacity100: number; // m³
  capacity98: number; // m³
}
export interface FlShip {
  id: string;
  nameZh: string;
  nameEn: string | null;
  imo: string | null;
  designer: string | null;
  designDocNo: string | null;
  designRev: string | null;
  ccsNo: string | null;
  ccsDate: string | null;
  tempMin: number;
  tempMax: number;
}

export interface InterpMeta {
  rho: number;
  from: TableRow;
  to: TableRow;
  ratio: number;
}

/** 线性内插密度;超出表范围返回 null。 */
export function densityAt(table: TableRow[], T: number): InterpMeta | null {
  if (!table.length) return null;
  const lo = table[0].t;
  const hi = table[table.length - 1].t;
  if (T < lo || T > hi) return null;
  for (let i = 0; i < table.length - 1; i++) {
    const a = table[i];
    const b = table[i + 1];
    if (T >= a.t && T <= b.t) {
      const ratio = b.t === a.t ? 0 : (T - a.t) / (b.t - a.t);
      const rho = a.rho + ratio * (b.rho - a.rho);
      return { rho, from: a, to: b, ratio };
    }
  }
  return null;
}

export type CalcResult =
  | { outOfRange: true }
  | {
      outOfRange: false;
      rhoL: number;
      ll: number;
      capped: boolean;
      maxVolume: number;
      maxWeight: number;
      interp: InterpMeta;
    };

export function calcTank(input: {
  capacity100: number;
  rhoR: number;
  table: TableRow[];
  temp: number;
}): CalcResult {
  const d = densityAt(input.table, input.temp);
  if (!d) return { outOfRange: true };
  const ll = Math.min((FL_COEFF * input.rhoR) / d.rho, FL_COEFF);
  const capped = (FL_COEFF * input.rhoR) / d.rho > FL_COEFF;
  return {
    outOfRange: false,
    rhoL: d.rho,
    ll,
    capped,
    maxVolume: ll * input.capacity100,
    maxWeight: FL_COEFF * input.capacity100 * input.rhoR,
    interp: d,
  };
}

/** 数字格式规范:体积 3 位、密度 4 位、LL% 两位、温度 1 位、重量 3 位。 */
export const fmt = {
  vol: (v: number | null | undefined) =>
    v == null || isNaN(v) ? "—" : Number(v).toFixed(3),
  den: (v: number | null | undefined) =>
    v == null || isNaN(v) ? "—" : Number(v).toFixed(4),
  wt: (v: number | null | undefined) =>
    v == null || isNaN(v) ? "—" : Number(v).toFixed(3),
  ll: (v: number | null | undefined) =>
    v == null || isNaN(v) ? "—" : (Number(v) * 100).toFixed(2),
  pct: (v: number | null | undefined) =>
    v == null || isNaN(v) ? "—" : Number(v).toFixed(2),
  tmp: (v: number | string | null | undefined) =>
    v == null || v === "" || isNaN(Number(v)) ? "—" : Number(v).toFixed(1),
};

/** 示例航次(V2613 湛江→钦州)—— 核查 Tab 对示例液化气船+丙烯的演示预填。 */
export const SAMPLE_VOYAGE = {
  shipId: "xt359",
  cargoCode: "C3H6",
  voyageNo: "V2613",
  route: "湛江 → 钦州",
  tanks: [
    { tankNo: "1", loadTemp: 28.9, actualVolume: 2256.064, actualWeight: 1126.23 },
    { tankNo: "2", loadTemp: 28.3, actualVolume: 2281.69, actualWeight: 1139.87 },
  ],
};
