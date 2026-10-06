import { resolveCatalogProduct } from "./product-catalog";
import type { Parcel, PortCall, StowVoyage } from "./types";

export interface ParsedMail { voyage: StowVoyage; unresolved: string[]; matched: { calls: number; parcels: number } }
type Kind = "load" | "discharge" | "unknown";
const normalize = (s: string) => s.toLowerCase().replace(/[\s\-_·,.()（）/]/g, "");

// A split-ticket remark can itself contain " · "; only split outside parentheses.
function segments(line: string): string[] {
  let depth = 0;
  let start = 0;
  const parts: string[] = [];
  for (let i = 0; i < line.length; i++) {
    if ("(（".includes(line[i])) depth++;
    if (")）".includes(line[i])) depth = Math.max(0, depth - 1);
    if (depth === 0 && (line[i] === ";" || (line[i] === "·" && /\s/.test(line[i - 1] ?? "") && /\s/.test(line[i + 1] ?? "")))) {
      parts.push(line.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(line.slice(start).trim());
  return parts;
}

export function parseNominationMail(text: string): ParsedMail {
  const voyage: StowVoyage = { shipId: "", voyageNo: "", calls: [], parcels: [] };
  const unresolved: string[] = [];
  const calls: { kind: Kind; call: PortCall }[] = [];
  const cargoLines: { line: string; original: string }[] = [];
  const counts = { load: 0, discharge: 0, unknown: 0 };
  let section: Kind | "parcels" | "remarks" | null = null;
  for (const original of text.split(/\r\n|\n|\r/)) {
    const line = original.replace(/：/g, ":").trim();
    const voyageNo = /^(?:航次号|Voyage):\s*(.*)$/i.exec(line);
    if (voyageNo) { voyage.voyageNo = voyageNo[1]; continue; }
    const departure = /^(?:出发日期|Departure):\s*(\d{4}-\d{2}-\d{2})$/i.exec(line);
    if (departure) { voyage.constants = { departureDate: departure[1] }; continue; }
    if (!line || /^(?:主题|Subject):/i.test(line) || section === "remarks") continue;
    if (/^(?:备注|Remarks):\s*$/i.test(line)) { section = "remarks"; continue; }
    if (/^(?:装港顺序|装港|Loading rotation|Load ports):\s*$/i.test(line)) { section = "load"; continue; }
    if (/^(?:卸港顺序|卸港|Discharging rotation|Discharge ports):\s*$/i.test(line)) { section = "discharge"; continue; }
    if (/^(?:其他停靠|Other calls):\s*$/i.test(line)) { section = "unknown"; continue; }
    if (/^(?:货票|货物|Cargo parcels|Cargoes):\s*$/i.test(line)) { section = "parcels"; continue; }
    if (!section) continue;
    if (section === "parcels") { cargoLines.push({ line, original }); continue; }
    const match = /^\s*\d+[.)]\s*([^/·]+?)(?:\s*\/\s*([^·]+?))?(?:\s*·\s*(.*))?$/.exec(line);
    if (!match) { unresolved.push(`无法解析行:${original.slice(0, 60)}`); continue; }
    const [, port, berth, rest = ""] = match;
    const draft = /最大吃水\s*([\d.]+)/.exec(rest);
    const water = /(咸淡水|海水|淡水|SW|FW|BW)\s*([\d.]+)?/i.exec(rest);
    const density = /水密度\s*([\d.]+)/.exec(rest);
    const waterDensity = density ? Number(density[1]) : water ? Number(water[2] ?? ({ 咸淡水: 1.015, 海水: 1.025, 淡水: 1, SW: 1.025, FW: 1, BW: 1.015 }[water[1].toUpperCase()])) : undefined;
    const call: PortCall = {
      id: `${{ load: "L", discharge: "D", unknown: "C" }[section]}${++counts[section]}`,
      seq: calls.length, port: port.trim(), berth: berth?.trim() ?? "",
      ...(draft ? { maxDraftM: Number(draft[1]) } : {}),
      ...(waterDensity != null ? { waterDensity } : {}),
    };
    for (const [key, label] of [
      ["distanceNm", "距上港"], ["speedKn", "航速"], ["portHours", "港时"],
      ["bunkerMt", "加油"], ["freshWaterTakeMt", "加水"],
    ] as const) {
      const value = new RegExp(label + "\\s*([\\d.]+)").exec(rest);
      if (value) call[key] = Number(value[1]);
    }
    if (/冬季区/.test(rest)) call.loadLineZone = "winter";
    else if (/热带区/.test(rest)) call.loadLineZone = "tropical";
    calls.push({ kind: section, call });
  }
  voyage.calls = calls.map(item => item.call);
  const findCall = (text: string, kind: Kind, name: string) => {
    const normalizedText = normalize(text);
    const matchKind = (k: Kind) => {
      const candidates = calls.filter(item => item.kind === k);
      return candidates.filter(item => normalizedText.includes(normalize(item.call.port + item.call.berth)))
        .sort((a, b) => normalize(b.call.port + b.call.berth).length - normalize(a.call.port + a.call.berth).length)[0]
        ?? candidates.filter(item => normalizedText.includes(normalize(item.call.port)))
          .sort((a, b) => a.call.seq - b.call.seq)[0];
    };
    const found = matchKind(kind) ?? matchKind("unknown");
    if (!found) unresolved.push(`${kind === "load" ? "装" : "卸"}港无法匹配停靠点:${text}(${name})`);
    return found?.call.id ?? "";
  };
  let priorityOrder = 0;
  for (const { line, original } of cargoLines) {
    const [display, quantity = "", ...rest] = segments(line.replace(/^\d+[.)]\s*/, ""));
    const compact = quantity.replace(/[,\s\u202f]/g, "");
    const range = /^([\d.]+)[–~\-]([\d.]+)(?:MT|t|吨)?(?:\(区间\)|（区间）)?$/i.exec(compact);
    const fixed = /^([\d.]+)(?:MT|t|吨)$/i.exec(compact);
    const priority = /尽量多|最大|max/i.test(compact);
    const ratio = /^(?:比例|ratio)([\d.]+)?$/i.exec(compact);
    if (!display || !(range || fixed || priority || ratio)) {
      unresolved.push(`无法解析行:${original.slice(0, 60)}`);
      continue;
    }
    let intake: Parcel["intake"];
    if (range) intake = { mode: "range", minMt: Number(range[1]), maxMt: Number(range[2]) };
    else if (priority) {
      priorityOrder++;
      intake = { mode: "priority", priority: Number(/优先([\d.]+)/.exec(compact)?.[1] ?? priorityOrder) };
    }
    else if (ratio) intake = { mode: "ratio", ratio: Number(ratio[1] ?? 1) };
    const product = resolveCatalogProduct(display)?.product;
    if (!product) unresolved.push(`未识别货品:${display},请手工指定 USCG 族与密度`);
    const density = rest.map(s => /^密度\s*([\d.]+)/.exec(s)).find(Boolean);
    const heating = rest.map(s => /^加温\s*(-?[\d.]+)\s*°C/i.exec(s)).find(Boolean);
    const route = rest.find(s => /->|→|至/.test(s))?.split(/->|→|至/).map(s => s.trim());
    voyage.parcels.push({
      id: `P${voyage.parcels.length + 1}`, productId: null,
      name: product?.name ?? display, display, group: product?.group ?? null,
      quantityMt: fixed ? Number(fixed[1]) : 0,
      density: density ? Number(density[1]) : product?.density ?? 0,
      loadCallId: findCall(route?.[0] ?? "", "load", display),
      dischargeCallId: findCall(route?.[1] ?? "", "discharge", display),
      heating: heating ? { enabled: true, carriageTempC: Number(heating[1]) } : { enabled: false },
      boilPointC: product?.boilPointC ?? null, meltPointC: product?.meltPointC ?? null,
      polymerizable: product?.polymerizable ?? false, maxAllowedTempC: null,
      ...(intake ? { intake } : {}),
    });
  }
  return { voyage, unresolved: Array.from(new Set(unresolved)), matched: { calls: voyage.calls.length, parcels: voyage.parcels.length } };
}
