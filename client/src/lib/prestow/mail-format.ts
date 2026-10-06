import type { Parcel, PortCall, StowVoyage } from "./types";

export interface MailMeta { from?: string; to?: string }

export function formatNominationMail(voyage: StowVoyage, meta: MailMeta = {}): { subject: string; body: string } {
  const loads = voyage.calls.filter(call => voyage.parcels.some(p => p.loadCallId === call.id));
  const discharges = voyage.calls.filter(call => voyage.parcels.some(p => p.dischargeCallId === call.id));
  const others = voyage.calls.filter(call => !loads.includes(call) && !discharges.includes(call));
  const ports = (calls: PortCall[]) => Array.from(new Set(calls.map(call => call.port))).join("-");
  const subject = `配载申请 / ${voyage.voyageNo} / ${ports(loads)} → ${ports(discharges)}`;
  const callLine = (call: PortCall) => {
    let line = `${voyage.calls.indexOf(call) + 1}. ${call.port}${call.berth ? ` / ${call.berth}` : ""}`;
    if (call.maxDraftM != null) line += ` · 最大吃水 ${call.maxDraftM.toFixed(1)} m`;
    if (call.waterDensity != null) {
      const label = call.waterDensity === 1.025 ? "海水" : call.waterDensity === 1 ? "淡水" : call.waterDensity === 1.015 ? "咸淡水" : "水密度";
      line += ` · ${label} ${call.waterDensity.toFixed(3)}`;
    }
    if (call.distanceNm != null) line += ` · 距上港 ${call.distanceNm} nm`;
    if (call.speedKn != null) line += ` · 航速 ${call.speedKn} kn`;
    if (call.portHours != null) line += ` · 港时 ${call.portHours} h`;
    if (call.bunkerMt != null) line += ` · 加油 ${call.bunkerMt} t`;
    if (call.freshWaterTakeMt != null) line += ` · 加水 ${call.freshWaterTakeMt} t`;
    if (call.loadLineZone === "winter") line += " · 冬季区";
    if (call.loadLineZone === "tropical") line += " · 热带区";
    return line;
  };
  const number = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 20 });
  const quantity = (p: Parcel) => {
    switch (p.intake?.mode) {
      case "priority": return `尽量多(优先 ${p.intake.priority})`;
      case "range": return `${number(p.intake.minMt ?? 0)}–${number(p.intake.maxMt ?? 0)} MT(区间)`;
      case "ratio": return `比例 ${p.intake.ratio}`;
      default: return `${number(p.quantityMt)} MT`;
    }
  };
  const endpoint = (id: string) => {
    const call = voyage.calls.find(call => call.id === id);
    return call ? `${call.port}${call.berth ? ` ${call.berth}` : ""}` : "";
  };
  const lines = [
    "操作部各位:", "",
    "请为下述航次准备预配载方案(货舱分配、逐港到港/离港吃水、稳性与强度校核),回复时请注明受限港。", "",
    `航次号: ${voyage.voyageNo}`, "船舶: 虚构船 · MR 型油化船(演示数据)",
    ...(voyage.constants?.departureDate ? [`出发日期: ${voyage.constants.departureDate}`] : []), "",
    "装港顺序:", ...loads.map(callLine), "",
    "卸港顺序:", ...discharges.map(callLine), "",
    ...(others.length ? ["其他停靠:", ...others.map(callLine), ""] : []),
    "货票:", ...voyage.parcels.map((p, i) =>
      `${i + 1}. ${p.display} · ${quantity(p)} · 密度 ${p.density.toFixed(3)} · ${endpoint(p.loadCallId)} → ${endpoint(p.dischargeCallId)}${p.heating.enabled ? ` · 加温 ${p.heating.carriageTempC} °C` : ""}`),
    "", "备注:",
    "- 以上船舶、航段距离、加油量、季节区、港口吃水限制与水密度均为演示值,不代表实际公告。",
    "- 货票名称后括号内为分票备注,请按票分别核算舱位与到港吃水。",
    "", "顺祝商祺", meta.from ?? "远航化学品船务(演示)· 租船操作",
  ];
  return { subject, body: lines.join("\r\n") };
}
