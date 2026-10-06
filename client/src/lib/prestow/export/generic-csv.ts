import type { PlanExporter } from "./index";
import { BOM, EOL, csvLine, f1, f4 } from "./csv-util";
import { byTankId } from "../engine";
import { listCompartments } from "../../hull";

export const genericCsvExporter: PlanExporter = {
  id: "generic-csv",
  label: "通用 CSV(Loadicator 通用导入)",
  ext: "csv",
  render(plan, rank, ship, voyage) {
    const parcelOf = new Map(voyage.parcels.map(p => [p.id, p]));
    const callOf = new Map(voyage.calls.map(c => [c.id, c]));
    const tanks = [...ship.tanks].sort((a, b) => byTankId(a.id, b.id));
    const ballastLabels = new Map(
      listCompartments("ballast").map(tank => [tank.id, tank.name])
    );
    const lines = [
      `# ${ship.label.includes("样船") ? "样船(合成数据)" : ship.label}`,
      `# 预配载方案 rank=${rank} key=${plan.key}`,
      "# 力矩类数值为预估值,以 Loadicator 为准",
      csvLine(["stage_seq", "port", "berth", "tank", "tank_label", "parcel", "fill_pct", "volume_m3", "density", "temp_c", "weight_mt", "ETA 天", "ETD 天", "航段 nm", "到港燃油 ROB", "离港燃油 ROB", "到港淡水 ROB", "离港淡水 ROB", "限值来源"]),
    ];
    for (const st of plan.stages) {
      const call = callOf.get(st.callId)!;
      const c = st.consumables;
      const voyageCells = [c?.etaDay, c?.etdDay, c?.legNm, c?.arrival.fuelMt, c?.departure.fuelMt, c?.arrival.freshWaterMt, c?.departure.freshWaterMt]
        .map(value => value == null ? "" : f1(value));
      voyageCells.push(st.floating?.limitSource ?? "");
      for (const t of tanks) {
        const l = st.tanks[t.id];
        const p = l ? parcelOf.get(l.parcelId)! : null;
        const temp = p ? (p.heating.enabled ? p.heating.carriageTempC : p.loadTempC ?? "") : "";
        lines.push(csvLine([
          call.seq, call.port, call.berth, t.id, t.label,
          p?.display ?? "", f1(l ? (l.volume / t.cap100) * 100 : 0), f1(l?.volume ?? 0),
          p ? f4(p.density) : "", temp, f1(l?.weight ?? 0), ...voyageCells,
        ]));
      }
      for (const ballast of st.floating?.ballastTanks ?? []) {
        lines.push(csvLine([
          call.seq,
          call.port,
          call.berth,
          ballast.id,
          ballastLabels.get(ballast.id) ?? ship.ballast.find(tank => tank.id === ballast.id)?.label ?? ballast.id,
          "BALLAST",
          f1(ballast.pct),
          f1(ballast.weight / 1.025),
          f4(1.025),
          "",
          f1(ballast.weight),
          ...voyageCells,
        ]));
      }
      lines.push(csvLine([
        call.seq,
        call.port,
        call.berth,
        "TOTAL",
        "",
        "",
        "",
        "",
        "",
        "",
        f1(st.totalWeight + (st.floating?.ballastMt ?? 0)),
        ...voyageCells,
      ]));
    }
    return {
      filename: `${voyage.voyageNo}_plan${String(rank).padStart(2, "0")}.csv`,
      content: BOM + lines.join(EOL) + EOL,
      mime: "text/csv;charset=utf-8",
    };
  },
};
