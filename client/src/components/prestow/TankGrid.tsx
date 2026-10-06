import { useEffect, useRef, useState } from "react";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { KvList } from "@/components/kv-list";
import { MButton } from "@/components/maritime";
import type { ParcelVisuals } from "./presentation";
import { allocationHistory } from "@/lib/prestow/stage-view";
import type {
  Allocation,
  PortCall,
  StageBallastTank,
  StageState,
  StowShip,
  StowVoyage,
} from "@/lib/prestow/types";

function portLabel(call: PortCall | undefined, calls: PortCall[]): string {
  if (!call) return "未指定";
  const port = call.port || "未填港口";
  const berths = new Set(
    calls
      .filter(item => (item.port || "未填港口") === port)
      .map(item => item.berth || "未填泊位"),
  );
  return berths.size > 1 ? `${port} · ${call.berth || "未填泊位"}` : port;
}

function fullPortLabel(call: PortCall | undefined): string {
  if (!call) return "未指定";
  return `${call.port || "未填港口"} · ${call.berth || "未填泊位"}`;
}

function formatTonnes(value: number): string {
  return Math.round(value).toLocaleString("en-US").replace(/,/g, "\u202f");
}


/** 舱格内货名:去掉尾部括号里的分票备注(如「(蔚山装)」),装港已在下一行显示;完整名在悬停提示里 */
function cellName(display: string): string {
  return display.replace(/\s*[(（][^()（）]*[)）]\s*$/, "").trim() || display;
}

export function TankGrid({
  ship,
  stage,
  stages,
  ballastTanks,
  allocations,
  voyage,
  visuals,
  stageLabel,
}: {
  ship: StowShip;
  stage: StageState | null;
  stages: StageState[];
  ballastTanks?: StageBallastTank[];
  allocations: Allocation[];
  voyage: StowVoyage;
  visuals: ParcelVisuals;
  stageLabel: string;
}) {
  const [detail, setDetail] = useState<{ title: string; ballastId?: string; items: { label: string; value: string }[] } | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => setDetail(null), [stage?.callId, allocations]);
  const parcelById = new Map(voyage.parcels.map(parcel => [parcel.id, parcel]));
  const callById = new Map(voyage.calls.map(call => [call.id, call]));
  const allocationsByTank = new Map<string, Allocation[]>();
  allocations.forEach(allocation =>
    allocation.tanks.forEach(tankId => {
      const entries = allocationsByTank.get(tankId) ?? [];
      entries.push(allocation);
      allocationsByTank.set(tankId, entries);
    })
  );
  const tanks = new Map(ship.tanks.map(tank => [tank.id, tank]));
  const stations = Array.from({ length: 10 }, (_, index) => 10 - index);
  const ballastById = new Map<string, StageBallastTank>();
  const displayedBallast = stage
    ? (ballastTanks ?? stage.floating?.ballastTanks ?? [])
    : stages.flatMap(item => item.floating?.ballastTanks ?? []);
  for (const tank of displayedBallast) {
    const current = ballastById.get(tank.id);
    if (!current || tank.pct > current.pct) ballastById.set(tank.id, tank);
  }
  // 翼压载舱按舷分开显示(横倾调整时 P/S 液位常不同);每个 WB 跨两个站位列
  const wingUnits = [5, 4, 3, 2, 1].map(number => ({ id: `WB${number}`, span: 2 }));
  const wbCell = (id: string, label: string, extra = "") => {
    const load = ballastById.get(id);
    const pct = load?.pct ?? 0;
    const weight = load?.weight ?? 0;
    return (
      <button
        type="button"
        className={`stow-wb${pct > 0 ? " stow-wb-f" : ""}${extra}`}
        key={id}
        aria-label={`${label} 压载舱，装载率 ${pct.toFixed(1)}%，查看详情`}
        onClick={event => {
          trigger.current = event.currentTarget;
          setDetail({ title: `${label} 压载舱`, ballastId: id, items: [
            { label: "装载率", value: `${pct.toFixed(1)}%` },
            { label: "重量", value: `${weight.toFixed(1)} MT` },
            { label: "说明", value: stage ? "本站离港状态" : "全航次逐舱最高装载率" },
          ] });
        }}
        title={
          pct > 0
            ? [`${label}`, `${pct.toFixed(1)}%`, `${weight.toFixed(1)} MT`, stage ? "" : "全航次最高装载率"].filter(Boolean).join("\n")
            : `${label} 无压载`
        }
      >
        <strong>{label}</strong>
        <span>{extra && "△ "}{pct.toFixed(0)}%</span>
      </button>
    );
  };
  const asymmetric = (number: number) => {
    const p = ballastById.get(`WB${number}P`)?.pct ?? 0;
    const st = ballastById.get(`WB${number}S`)?.pct ?? 0;
    return Math.abs(p - st) > 5 ? " stow-wb-asym" : "";
  };
  const wingRow = (side: "P" | "S") => (
    <div className="stow-wb-row" key={`wb-${side}`}>
      <div className="stow-tank-side">WB {side}</div>
      {wingUnits.map(unit => (
        <div className="stow-wb-span" key={`${unit.id}${side}`}>
          {wbCell(`${unit.id}${side}`, `${unit.id}${side}`, asymmetric(Number(unit.id.slice(2))))}
        </div>
      ))}
    </div>
  );
  const detailItems = detail?.items.map(item => {
    if (!detail.ballastId) return item;
    const current = ballastById.get(detail.ballastId);
    if (item.label === "装载率") return { ...item, value: `${(current?.pct ?? 0).toFixed(1)}%` };
    if (item.label === "重量") return { ...item, value: `${(current?.weight ?? 0).toFixed(1)} MT` };
    return item;
  }) ?? [];

  return (
    <>
    <div className="stow-tank-scroll" role="region" aria-label="舱位图，可横向滚动" tabIndex={0}>
      <div className="stow-tank-grid">
        <div className="stow-tank-dir">
          <span>船尾 AFT</span>
          <span>船首 FWD ▸</span>
        </div>
        <div className="stow-tank-corner">站位</div>
        {stations.map(station => (
          <div className="stow-tank-heading" key={`heading-${station}`}>
            {station === 10 ? "SLOP" : `CT${station}`}
          </div>
        ))}

        {wingRow("P")}
        {(["P", "S"] as const).map(side => (
          <div className="stow-tank-row" key={side}>
            <div className="stow-tank-side">{side}</div>
            {stations.map(station => {
              const id = `${station}${side}`;
              const tank = tanks.get(id)!;
              const stageLoad = stage?.tanks[id] ?? null;
              const history = allocationHistory(allocationsByTank.get(id) ?? [], voyage);
              const tankAllocations = history.ordered;
              const allocation =
                stage === null ? tankAllocations.at(-1) : undefined;
              const parcelId = stageLoad?.parcelId ?? allocation?.parcelId;
              const parcel = parcelId ? parcelById.get(parcelId) : null;
              const fillRatio = stageLoad
                ? stageLoad.volume / tank.cap100
                : (allocation?.fillRatio ?? 0);
              const volume = stageLoad?.volume ?? tank.cap100 * fillRatio;
              const weight =
                stageLoad?.weight ?? volume * (parcel?.density ?? 0);
              const loaded = Boolean(parcel);
              const reused = stage === null && tankAllocations.length > 1;
              const conflict = stage === null && history.conflict;
              const undetermined = loaded && parcel?.group == null;
              const loadCall = parcel
                ? callById.get(parcel.loadCallId)
                : undefined;
              const dischargeCall = parcel
                ? callById.get(parcel.dischargeCallId)
                : undefined;
              const loadPort = portLabel(loadCall, voyage.calls);
              const dischargePort = portLabel(dischargeCall, voyage.calls);
              const fillPct = Math.max(0, Math.min(100, fillRatio * 100));

              return (
                <button
                  type="button"
                  className={[
                    "stow-cell",
                    !loaded && "stow-cell-empty",
                    undetermined && "stow-cell-undetermined",
                    conflict && "stow-cell-conflict",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  key={id}
                  style={
                    loaded && !undetermined && !conflict
                      ? { background: visuals[parcel!.id].color }
                      : undefined
                  }
                  title={
                    loaded
                      ? `${parcel!.display}\n重量 ${weight.toFixed(1)} MT\n体积 ${volume.toFixed(1)} m³\n装 ${fullPortLabel(loadCall)}\n卸 ${fullPortLabel(dischargeCall)}`
                      : `${id} 空舱`
                  }
                  aria-label={`${id} ${loaded ? `${visuals[parcel!.id].label} ${parcel!.display}` : "空舱"}，查看详情`}
                  onClick={event => {
                    trigger.current = event.currentTarget;
                    setDetail({ title: `${id} · ${loaded ? `${visuals[parcel!.id].label} ${parcel!.display}` : "空舱"}`, items: [
                      { label: "重量", value: `${weight.toFixed(1)} MT` },
                      { label: "体积", value: `${volume.toFixed(1)} m³` },
                      { label: "装载率", value: `${(fillRatio * 100).toFixed(1)}%` },
                      { label: "舱容", value: `${tank.cap100.toFixed(1)} m³` },
                      ...(loaded ? [
                        { label: "装货港 / 泊位", value: fullPortLabel(loadCall) },
                        { label: "卸货港 / 泊位", value: fullPortLabel(dischargeCall) },
                      ] : []),
                      ...(reused ? [{ label: "分配提示", value: conflict ? "此舱货票占用港序重叠，请逐站核对。" : "此舱按港序先卸后装，总览显示最后一票。" },
                        ...tankAllocations.map(item => {
                          const assigned = parcelById.get(item.parcelId)!;
                          return { label: visuals[assigned.id].label, value: `${assigned.display} · ${fullPortLabel(callById.get(assigned.loadCallId))} → ${fullPortLabel(callById.get(assigned.dischargeCallId))}` };
                        }),
                      ] : []),
                      ...(undetermined ? [{ label: "相容性", value: "货物分组未确定" }] : []),
                    ] });
                  }}
                >
                  <span className="stow-cell-id">{id}{loaded && <small>{visuals[parcel!.id].label}</small>}</span>
                  {loaded ? (
                    <>
                      <span className="stow-cell-nm">{cellName(parcel!.display)}</span>
                      {(reused || undetermined) && <span className="stow-cell-flag">{conflict ? "占用重叠" : undetermined ? "分组未定" : `复用 ${tankAllocations.length} 票`}</span>}
                      <span className="stow-cell-pt">
                        {loadPort} → {dischargePort}
                      </span>
                      <span className="stow-cell-fill">
                        <strong>{fillPct.toFixed(1)}%</strong>
                        <small>{formatTonnes(weight)} t</small>
                      </span>
                      <span className="stow-cell-bar" aria-hidden="true">
                        <i style={{ width: `${fillPct}%` }} />
                      </span>
                    </>
                  ) : (
                    <span className="stow-cell-nm">空舱</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}

        {wingRow("S")}
        <div className="stow-wb-row">
          <div className="stow-tank-side">尖舱</div>
          <div className="stow-wb-span">{wbCell("APT", "APT")}</div>
          <div className="stow-wb-gap" aria-hidden="true" />
          <div className="stow-wb-span">{wbCell("FPT", "FPT")}</div>
        </div>
      </div>
    </div>
    {wingUnits.some(unit => asymmetric(Number(unit.id.slice(2)))) && <p className="stow-tank-note">△ 压载左右舷装载率差超过 5 个百分点，点击 WB 舱格查看。</p>}
    <Dialog open={detail !== null} onOpenChange={open => { if (!open) setDetail(null); }}>
      <DialogContent className="stow-tank-dialog" showCloseButton={false} onCloseAutoFocus={event => { event.preventDefault(); trigger.current?.focus({ preventScroll: true }); }}>
        <DialogTitle>{detail?.title}</DialogTitle>
        <DialogDescription>{stageLabel}</DialogDescription>
        <KvList className="stow-stage-metrics" items={detailItems} />
        <DialogClose asChild><MButton type="button" variant="soft">关闭舱位详情</MButton></DialogClose>
      </DialogContent>
    </Dialog>
    </>
  );
}
