import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, LayoutGrid, MapPin } from "lucide-react";
import { MButton } from "@/components/maritime";
import { VerdictBadge } from "@/components/verdict";
import { draftMarginVerdict, trimReliefHint } from "./presentation";
import { track } from "@/lib/track";
import { stageDraftMargin } from "@/lib/prestow/engine";
import type { PortCall, StageState } from "@/lib/prestow/types";

type TimelineCall = PortCall & { actionLabel?: string };

function metric(value: number | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(digits);
}

export function StageTimeline({
  stages,
  calls,
  selected,
  onSelect,
  minMarginStage,
  departureDate,
}: {
  stages: StageState[];
  calls: PortCall[];
  selected: number | "all";
  onSelect(i: number | "all", navigate?: boolean): void;
  minMarginStage: number | null;
  departureDate?: string;
}) {
  const [showVoyage, setShowVoyage] = useState(false);
  const timeline = useRef<HTMLDivElement>(null);
  const select = (index: number | "all", navigate = true) => {
    onSelect(index, navigate);
    track("stage_select", { index });
    const strip = timeline.current;
    if (!navigate && typeof index === "number" && strip && strip.scrollWidth > strip.clientWidth) {
      const card = strip.querySelectorAll<HTMLButtonElement>(".stage")[index];
      if (card) strip.scrollTo({ left: card.offsetLeft - (strip.clientWidth - card.offsetWidth) / 2 });
    }
  };
  const day = (value: number) => {
    const date = departureDate ? new Date(`${departureDate}T00:00:00Z`).getTime() + value * 86400000 : NaN;
    return <>D+{value.toFixed(1)}{Number.isFinite(date) && <small>{new Date(date).toISOString().slice(5, 10)}</small>}</>;
  };
  const tonnes = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return (
    <>
    <div className="stow-timeline-toolbar">
      <strong>港序时间线 <small>{calls.length} 站 · 吃水 / 裕量 m</small></strong>
      <div className="stow-timeline-actions">
        <MButton
          type="button"
          variant="ghost"
          size="sm"
          icon={LayoutGrid}
          className="stow-overview-toggle"
          aria-pressed={selected === "all"}
          title="查看各舱最终分配，不代表同一时点"
          onClick={() => select("all")}
        >分配总览</MButton>
        {minMarginStage !== null && calls[minMarginStage] && (
          <MButton type="button" variant="ghost" size="sm" icon={MapPin} onClick={() => select(minMarginStage, false)}>
            定位约束港 · {calls[minMarginStage].port || "未填港口"}
          </MButton>
        )}
      </div>
      <label><input type="checkbox" checked={showVoyage} onChange={event => setShowVoyage(event.target.checked)} />展开航时与油水</label>
      <div className="stow-stage-navigation">
        <button type="button" aria-label="上一站" disabled={selected === "all" || selected === 0} onClick={() => { if (typeof selected === "number" && selected > 0) select(selected - 1, false); }}><ChevronLeft size={18} /></button>
        <span aria-live="polite">{selected === "all" ? "分配总览" : `第 ${selected + 1} / ${calls.length} 站`}</span>
        <button type="button" aria-label="下一站" disabled={selected === calls.length - 1} onClick={() => select(selected === "all" ? 0 : selected + 1, false)}><ChevronRight size={18} /></button>
      </div>
    </div>
    <div ref={timeline} className="stow-timeline" role="group" aria-label="港序时间线">
      {calls.map((call, index) => {
        const stage = stages[index];
        const c = stage?.consumables;
        const departure = stage?.floating;
        const ballastRule = departure?.ballastRule;
        const arrival = stage?.arrival;
        const margin = stage ? stageDraftMargin(stage) : undefined;
        const strengthPct = departure
          ? Math.max(departure.sfPct, departure.bmPct)
          : undefined;
        const draftExceeded = draftMarginVerdict(margin) === "fail";
        const draftBinding = draftMarginVerdict(margin) === "warn";
        const marginPhase = arrival?.draftMargin != null &&
          (departure?.draftMargin == null || arrival.draftMargin <= departure.draftMargin)
          ? "到港" : "离港";
        const hint = trimReliefHint(marginPhase === "到港" ? arrival : departure);
        const action = (call as TimelineCall).actionLabel ?? "装 / 卸";
        const deepestDraft = Math.max(arrival?.draftFwd ?? -Infinity, arrival?.draftAft ?? -Infinity, departure?.draftFwd ?? -Infinity, departure?.draftAft ?? -Infinity);
        const draftClass = (value: number | undefined) => value === deepestDraft ? draftExceeded ? "fail" : draftBinding ? "warn" : undefined : undefined;

        return (
          <button
            type="button"
            aria-pressed={selected === index}
            className={`stage${selected === index ? " on" : ""}`}
            key={call.id}
            onClick={() => select(index)}
            title={`${call.port || "未填港口"} · ${call.berth || "未填泊位"}`}
          >
            <span className="stage-t">
              <span className="stage-seq">{index + 1}</span>
              <strong>{call.port || "未填港口"}</strong>
              <span className="stage-berth" title={call.berth || "未填泊位"}>{call.berth || "未填泊位"}</span>
              <span className={`stage-on${action === "卸" ? " dis" : ""}`}>{action}</span>
            </span>
            <i className="stage-sep" aria-hidden="true" />
            <span className="stage-drafts">
              <span /><i>艏</i><i>艉</i><i>纵倾</i>
              <i title={!arrival ? "未提供到港工况" : undefined}>到港</i><span className={draftClass(arrival?.draftFwd)}>{metric(arrival?.draftFwd)}</span><span className={draftClass(arrival?.draftAft)}>{metric(arrival?.draftAft)}</span><span className="dim">—</span>
              <i>离港</i><span className={draftClass(departure?.draftFwd)}>{metric(departure?.draftFwd)}</span><span className={draftClass(departure?.draftAft)}>{metric(departure?.draftAft)}</span><span>{metric(departure?.trim)}</span>
            </span>
            <span className="stage-limit">
              <span className="kv"><i>限</i>{departure?.maxDraftM == null ? "不限" : metric(departure.maxDraftM)}
                {departure?.maxDraftM != null && departure.limitSource === "ship" && <small>结构</small>}
                {departure?.maxDraftM != null && departure.limitSource === "zone" && <small title="载重线限制">{departure.zone === "winter" ? "冬季" : "热带"}</small>}
              </span>
              <span className="kv"><i>ρ</i>{metric(departure?.waterDensity, 3)}</span>
              <span className="stage-spacer" />
              <span className={`kv stage-margin${minMarginStage === index ? " stage-constraint" : ""}${draftExceeded ? " fail" : draftBinding ? " warn" : ""}`}>
                <i>{minMarginStage === index ? "约束港" : "最小裕量"} · {margin == null ? "—" : marginPhase}</i>{metric(margin)}
              </span>
              {hint && <span className={`stage-trim-hint${hint.enough ? "" : " fail"}`}>
                {hint.relaxed ? "已放宽纵倾至平吃水" : `调平吃水可换出 ${hint.reliefM.toFixed(2)} m`}
                {hint.relaxed ? "" : hint.enough ? " · 可解" : ` · 仍差 ${(-(margin! + hint.reliefM)).toFixed(2)} m`}
              </span>}
            </span>
            {c && showVoyage && <>
              <i className="stage-sep" aria-hidden="true" />
              <span className="stage-eta">
                <span className="kv"><i>ETA</i>{day(c.etaDay)}</span>
                <span className="kv"><i>ETD</i>{day(c.etdDay)}</span>
                <span className="kv stage-rob"><i>燃油</i>{tonnes(c.arrival.fuelMt)}<span className="stage-arrow">→</span>{tonnes(c.departure.fuelMt)}{c.bunkerMt > 0 && <b className="stage-take">+{tonnes(c.bunkerMt)}</b>}</span>
                <span className="kv stage-rob"><i>淡水</i>{tonnes(c.arrival.freshWaterMt)}<span className="stage-arrow">→</span>{tonnes(c.departure.freshWaterMt)}{c.freshWaterTakeMt > 0 && <b className="stage-take">+{tonnes(c.freshWaterTakeMt)}</b>}</span>
              </span>
            </>}
            {ballastRule?.dmMin != null && (
              <span className={`stage-limit stage-ballast-rule${ballastRule.ok ? "" : " fail"}`}>
                <span className="kv"><i>dm</i>{metric(ballastRule.dm)}<small>≥ {metric(ballastRule.dmMin, 1)}</small></span>
                <span className="kv"><i>纵倾</i>{metric(departure?.trim, 1)}<small>≤ {metric(ballastRule.trimMax, 1)}</small></span>
              </span>
            )}
            <i className="stage-sep" aria-hidden="true" />
            <span className="stage-badges">
              <VerdictBadge verdict={departure?.stabilityPass && arrival?.stabilityPass !== false ? "pass" : "fail"}>
                {departure?.stabilityPass && arrival?.stabilityPass !== false ? "✓ 稳性" : "✗ 稳性不通过"}
              </VerdictBadge>
              {departure?.strengthChecked === false ? (
                <VerdictBadge verdict="none">强度 未校核</VerdictBadge>
              ) : (
                <VerdictBadge verdict={departure?.strengthPass && arrival?.strengthPass !== false ? "pass" : "fail"}>
                  {departure?.strengthPass && arrival?.strengthPass !== false
                    ? "✓ 强度"
                    : `✗ 强度 ${metric(strengthPct, 0)}%`}
                </VerdictBadge>
              )}
              {ballastRule?.dmMin != null && !ballastRule.ok ? (
                <VerdictBadge verdict="fail">压载 不足</VerdictBadge>
              ) : draftExceeded ? (
                <VerdictBadge verdict="fail">吃水 超限</VerdictBadge>
              ) : draftBinding ? (
                <VerdictBadge verdict="warn">△ 裕量临界</VerdictBadge>
              ) : (
                <VerdictBadge verdict="none">
                  压载 {metric(departure?.ballastMt, 0)} t
                </VerdictBadge>
              )}
            </span>
            {c?.warnings.map((warning, i) => <span key={i} className={`stage-warning${/燃油不足|淡水不足/.test(warning) ? " fail" : ""}`}>{warning}</span>)}
          </button>
        );
      })}
    </div>
    </>
  );
}
