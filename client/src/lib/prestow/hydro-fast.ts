import { DEFAULT_HULL_PARAMS, hullProps } from "../hull";

export interface FastFloating {
  draftMid: number;
  draftAft: number;
  draftFwd: number;
  trim: number;
  displacement: number;
  lcb: number;
  lcf: number;
  mtc: number;
  tpc: number;
  kmT: number;
}

interface HydroRow {
  draftMid: number;
  displacement: number;
  volume: number;
  lcb: number;
  lcf: number;
  mtc: number;
  tpc: number;
  kmT: number;
}

const REFERENCE_DENSITY = 1.025;
const DRAFT_FROM = 2;
const DRAFT_TO = 16;
const DRAFT_STEP = 0.2;

let hydroCache: HydroRow[] | undefined;

function hydroTable(): HydroRow[] {
  if (hydroCache) return hydroCache;
  const count = Math.round((DRAFT_TO - DRAFT_FROM) / DRAFT_STEP);
  hydroCache = Array.from({ length: count + 1 }, (_, index) => {
    const draftMid = DRAFT_FROM + index * DRAFT_STEP;
    const props = hullProps({ draftMid, trim: 0, heel: 0 }, REFERENCE_DENSITY);
    return {
      draftMid,
      displacement: props.disp,
      volume: props.volume,
      lcb: props.lcb,
      lcf: props.lcf,
      mtc: props.mtc,
      tpc: props.tpc,
      kmT: props.kmT,
    };
  });
  return hydroCache;
}

function bracket(rows: HydroRow[], volume: number): [HydroRow, HydroRow] {
  if (volume <= rows[0].volume) return [rows[0], rows[1]];
  const last = rows.length - 1;
  if (volume >= rows[last].volume) return [rows[last - 1], rows[last]];

  let low = 0;
  let high = last;
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (rows[mid].volume <= volume) low = mid;
    else high = mid;
  }
  return [rows[low], rows[high]];
}

export function fastFloating(weight: number, lcg: number, rho = REFERENCE_DENSITY): FastFloating {
  const volume = weight / rho;
  const [lower, upper] = bracket(hydroTable(), volume);
  const fraction = (volume - lower.volume) / (upper.volume - lower.volume);
  const interpolate = (key: keyof HydroRow) => lower[key] + fraction * (upper[key] - lower[key]);
  const draftMid = interpolate("draftMid");
  const lcb = interpolate("lcb");
  const lcf = interpolate("lcf");
  const mtc = interpolate("mtc") * rho / REFERENCE_DENSITY;
  const tpc = interpolate("tpc") * rho / REFERENCE_DENSITY;
  const kmT = interpolate("kmT");
  const trim = (lcb - lcg) * weight / (100 * mtc);
  const lbp = DEFAULT_HULL_PARAMS.lbp;

  return {
    draftMid,
    draftAft: draftMid + trim * lcf / lbp,
    draftFwd: draftMid - trim * (lbp - lcf) / lbp,
    trim,
    displacement: weight,
    lcb,
    lcf,
    mtc,
    tpc,
    kmT,
  };
}

export function resetFastHydroCache(): void {
  hydroCache = undefined;
}
