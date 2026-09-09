import type { ExportFile } from "./index";
import type { StowResult, StowShip, StowVoyage } from "../types";
import { BOM, EOL, csvLine, f1 } from "./csv-util";

export function renderSummaryCsv(result: Extract<StowResult, { status: "ok" | "truncated" }>, _ship: StowShip, voyage: StowVoyage): ExportFile {
  const disp = new Map(voyage.parcels.map(p => [p.id, p.display]));
  const lines = [csvLine(["rank", "key", "tanks_used", "unpaired", "max_heel_tm", "max_lcg_shift_m", "advisories", "allocations"])];
  result.plans.forEach((p, i) => {
    const alloc = p.allocations.map(a => `${disp.get(a.parcelId)}:${a.tanks.join("+")}`).join("|");
    lines.push(csvLine([i + 1, p.key, p.score.tanksUsed, p.score.unpairedTanks, f1(p.score.maxHeelMoment), f1(p.score.maxLcgShift), p.score.advisoryCount, alloc]));
  });
  lines.push(`# status=${result.status} totalFound=${result.totalFound}`);
  return { filename: `${voyage.voyageNo}_summary.csv`, content: BOM + lines.join(EOL) + EOL, mime: "text/csv;charset=utf-8" };
}
