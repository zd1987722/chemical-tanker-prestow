import { useEffect, useMemo, useRef, useState } from "react";
import { track } from "@/lib/track";
import { ArrowLeft, ArrowRight, Download, LayoutGrid } from "lucide-react";
import { useLocation } from "wouter";
import { KvList } from "@/components/kv-list";
import { Empty, MButton, MCard, SectionTitle } from "@/components/maritime";
import { VerdictBadge } from "@/components/verdict";
import { draftMarginVerdict, scrollToStowSection, type ParcelVisuals } from "./presentation";
import { usePrecisePlan } from "./usePrecisePlan";
import {
  computeDamage,
  generateCases,
  type DamageCaseResult,
  type DamageInput,
  type DamageResult,
} from "@/lib/damage";
import { lightshipSummary } from "@/lib/hull";
import {
  CONDITIONS_STORAGE_KEY,
  CURRENT_CONDITION_STORAGE_KEY,
  parseConditions,
  serializeConditions,
} from "@/lib/loadcalc/storage";
import { safeGet, safeSet } from "@/lib/safe-storage";
import { downloadText } from "@/lib/prestow/download";
import { summarizeConsumables } from "@/lib/prestow/consumption";
import { DEFAULT_CONSTANTS, stageDraftMargin } from "@/lib/prestow/engine";
import { EXPORTERS } from "@/lib/prestow/export";
import { fastFloating } from "@/lib/prestow/hydro-fast";
import { fastStability } from "@/lib/prestow/stability-fast";
import { stageViewToCondition } from "@/lib/prestow/to-condition";
import { planStageViews } from "@/lib/prestow/stage-view";
import type {
  StageState,
  StowPlan,
  StowShip,
  StowVoyage,
} from "@/lib/prestow/types";
import { generalCriteria } from "@/lib/stability";
import { ParcelLegend } from "./ParcelLegend";
import { StageTimeline } from "./StageTimeline";
import { TankGrid } from "./TankGrid";

function stagePercentage(value: number | undefined): string {
  return value == null ? "—" : `${value.toFixed(1)}%`;
}

function collectDamageResult(cases: DamageCaseResult[]): DamageResult {
  const failures = cases.filter(item => !item.pass);
  const candidates = failures.length > 0 ? failures : cases;
  const worst = candidates.reduce<DamageCaseResult | undefined>(
    (current, item) =>
      !current || item.range < current.range ? item : current,
    undefined
  );
  return {
    cases,
    worst: worst?.case.id ?? "",
    pass: failures.length === 0,
  };
}

function damageInputForStage(
  stage: StageState,
  ship: StowShip,
  voyage: StowVoyage,
  rho: number
): DamageInput {
  const lightship = lightshipSummary();
  const constants = { ...DEFAULT_CONSTANTS, ...voyage.constants };
  const lightshipWeight =
    voyage.constants?.lightshipOverride ?? lightship.weight;
  const tanks: DamageInput["tanks"] = [];

  for (const tank of ship.tanks) {
    const load = stage.tanks[tank.id];
    if (!load || load.weight <= 0) continue;
    tanks.push({
      compId: tank.id,
      kind: "cargo",
      density: load.volume > 0 ? load.weight / load.volume : undefined,
      fillPct: (load.volume / tank.cap100) * 100,
      weight: load.weight,
      lcg: tank.lcg,
      tcg: tank.tcg,
      vcg: tank.vcg,
      fsm: 0,
    });
  }

  const cargoWeight = tanks.reduce((sum, tank) => sum + tank.weight, 0);
  const weight =
    lightshipWeight +
    constants.bunkersMt +
    constants.freshWaterMt +
    constants.constantsMt +
    cargoWeight;
  return {
    weight,
    lcg:
      (lightshipWeight * lightship.lcg +
        constants.bunkersMt * constants.bunkersLcg +
        constants.freshWaterMt * constants.freshWaterLcg +
        constants.constantsMt * constants.constantsLcg +
        tanks.reduce((sum, tank) => sum + tank.weight * tank.lcg, 0)) /
      weight,
    tcg:
      (lightshipWeight * lightship.tcg +
        tanks.reduce((sum, tank) => sum + tank.weight * tank.tcg, 0)) /
      weight,
    vcg:
      (lightshipWeight * lightship.vcg +
        constants.bunkersMt * constants.bunkersVcg +
        constants.freshWaterMt * constants.freshWaterVcg +
        constants.constantsMt * constants.constantsVcg +
        tanks.reduce((sum, tank) => sum + tank.weight * tank.vcg, 0)) /
      weight,
    fsmTotal: 0,
    rho,
    tanks,
  };
}

export function PlanDetail({
  plan,
  rank,
  ship,
  voyage,
  visuals,
  initialCallId,
  onCallChange,
}: {
  plan: StowPlan | null;
  rank: number;
  ship: StowShip;
  voyage: StowVoyage;
  visuals: ParcelVisuals;
  initialCallId?: string | null;
  onCallChange?(callId: string | null): void;
}) {
  const [, setLocation] = useLocation();
  const [callId, setCallId] = useState<string | null>(initialCallId ?? null);
  const firstPlanRender = useRef(true);
  const selectCall = (next: string | null) => {
    setCallId(next);
    onCallChange?.(next);
  };
  const [stageDamage, setStageDamage] = useState<DamageResult | null>(null);
  const [damageProgress, setDamageProgress] = useState<{
    completed: number;
    total: number;
  } | null>(null);
  const [damageRunning, setDamageRunning] = useState(false);
  const damageTimerRef = useRef<number | null>(null);
  const damageRunRef = useRef(0);
  const damageCases = useMemo(() => generateCases(), []);
  const calls = useMemo(
    () => [...voyage.calls].sort((a, b) => a.seq - b.seq),
    [voyage.calls]
  );
  const precision = usePrecisePlan(ship, voyage, plan);
  const preciseByCall = precision.stages;
  const stageViews = useMemo(() => plan ? planStageViews(plan, preciseByCall) : {}, [plan, preciseByCall]);
  const stageCriteria = useMemo(() => {
    if (!plan || !callId) return null;
    const selectedStage = plan.stages.find(item => item.callId === callId);
    const floating = selectedStage?.floating;
    if (!selectedStage || !floating) return null;
    const kmT = fastFloating(
      floating.displacement,
      0,
      floating.waterDensity
    ).kmT;
    const kgCorrected = kmT - floating.gmCorrected;
    const stability = fastStability(
      floating.displacement,
      kgCorrected,
      selectedStage.heelMomentTm / floating.displacement,
      floating.waterDensity,
      kmT
    );
    return generalCriteria(stability.curve, floating.gmCorrected, null).filter(
      criterion => criterion.id !== "2.2.4"
    );
  }, [callId, plan]);

  useEffect(() => {
    if (firstPlanRender.current) {
      firstPlanRender.current = false;
      return;
    }
    selectCall(null);
  }, [plan?.key]);
  useEffect(() => {
    damageRunRef.current += 1;
    if (damageTimerRef.current !== null)
      window.clearTimeout(damageTimerRef.current);
    damageTimerRef.current = null;
    setStageDamage(null);
    setDamageProgress(null);
    setDamageRunning(false);
  }, [callId, plan, ship, voyage]);
  useEffect(
    () => () => {
      damageRunRef.current += 1;
      if (damageTimerRef.current !== null)
        window.clearTimeout(damageTimerRef.current);
    },
    []
  );

  if (plan === null) {
    return (
      <MCard id="stow-plan-detail" className="stow-column-card">
        <SectionTitle>方案详情</SectionTitle>
        <Empty icon={LayoutGrid} title="选择一个方案查看详情" />
      </MCard>
    );
  }

  const selectedView = callId ? stageViews[callId] : undefined;
  const stage = selectedView?.stage ?? null;
  const precise = selectedView?.precise ?? null;
  const callById = new Map(voyage.calls.map(call => [call.id, call]));
  const stageWorst =
    stageDamage?.cases.find(item => item.case.id === stageDamage.worst) ?? null;
  const selectedStageIndex = callId
    ? calls.findIndex(call => call.id === callId)
    : -1;
  const selectedCall =
    selectedStageIndex >= 0 ? calls[selectedStageIndex] : null;
  const timelineCalls = calls.map(call => {
    const loads = voyage.parcels.some(parcel => parcel.loadCallId === call.id);
    const discharges = voyage.parcels.some(
      parcel => parcel.dischargeCallId === call.id
    );
    return {
      ...call,
      actionLabel:
        loads && discharges
          ? "装 / 卸"
          : loads
            ? "装"
            : discharges
              ? "卸"
              : "过境",
    };
  });
  const timelineStages: StageState[] = calls.map(call => stageViews[call.id].stage);
  const minMarginStage = timelineStages.reduce<number | null>(
    (minimumIndex, item, index) => {
      const margin = stageDraftMargin(item);
      if (margin == null || !Number.isFinite(margin))
        return minimumIndex;
      if (minimumIndex === null) return index;
      return margin < stageDraftMargin(timelineStages[minimumIndex])!
        ? index
        : minimumIndex;
    },
    null
  );
  const minDraftMargin =
    minMarginStage === null
      ? undefined
      : stageDraftMargin(timelineStages[minMarginStage]);
  const draftBindingCall = minMarginStage === null ? undefined : calls[minMarginStage];
  const draftBindingStage = minMarginStage === null
    ? undefined
    : timelineStages[minMarginStage];
  const draftBindingPhase = draftBindingStage?.arrival?.draftMargin != null &&
    (draftBindingStage.floating?.draftMargin == null ||
      draftBindingStage.arrival.draftMargin <= draftBindingStage.floating.draftMargin)
    ? "到港"
    : "离港";
  const draftVerdict = draftMarginVerdict(minDraftMargin);
  const stageLabel = selectedCall
    ? `第 ${selectedStageIndex + 1} 站 ${selectedCall.port || "未填港口"} · 离港 / 作业后`
    : "分配总览 · 各舱最终分配";

  const sendToLoadCalc = () => {
    if (!selectedView || !callId) return;
    const call = callById.get(callId);
    if (!call) return;
    const condition = stageViewToCondition(
      ship,
      voyage,
      selectedView,
      `${voyage.voyageNo} · 方案 #${rank} · ${call.port || "未填港口"} ${call.berth || "未填泊位"} · 离港`
    );
    const conditions = parseConditions(safeGet(CONDITIONS_STORAGE_KEY));
    safeSet(
      CONDITIONS_STORAGE_KEY,
      serializeConditions([...conditions, condition])
    );
    safeSet(CURRENT_CONDITION_STORAGE_KEY, condition.id);
    track("send_to_loadcalc");
    setLocation("~/demo/loadcalc");
  };

  const runDamageCheck = () => {
    if (!stage || !callId) return;
    const call = callById.get(callId);
    if (!call) return;
    if (damageTimerRef.current !== null)
      window.clearTimeout(damageTimerRef.current);
    const runId = damageRunRef.current + 1;
    damageRunRef.current = runId;
    const input = damageInputForStage(
      stage,
      ship,
      voyage,
      call.waterDensity ?? 1.025
    );
    const calculated: DamageCaseResult[] = [];
    const total = damageCases.length;
    setStageDamage(null);
    setDamageProgress({ completed: 0, total });
    setDamageRunning(true);

    if (total === 0) {
      setStageDamage({ cases: [], worst: "", pass: true });
      setDamageRunning(false);
      return;
    }

    const runBatch = (index: number) => {
      damageTimerRef.current = window.setTimeout(() => {
        if (damageRunRef.current !== runId) return;
        calculated.push(computeDamage(input, [damageCases[index]]).cases[0]);
        const completed = index + 1;
        setDamageProgress({ completed, total });
        if (completed < total) runBatch(completed);
        else {
          damageTimerRef.current = null;
          setStageDamage(collectDamageResult(calculated));
          setDamageRunning(false);
        }
      }, 0);
    };
    runBatch(0);
  };

  const consumables = summarizeConsumables(plan.stages.flatMap(stage => stage.consumables ? [stage.consumables] : []), voyage);
  const tonnes = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  const stageConsumables = stage?.consumables;
  const day = (value: number) => {
    const date = voyage.constants?.departureDate
      ? new Date(`${voyage.constants.departureDate}T00:00:00Z`).getTime() + value * 86400000
      : NaN;
    return `D+${value.toFixed(1)}${Number.isFinite(date) ? `(${new Date(date).toISOString().slice(5, 10)})` : ""}`;
  };

  return (
    <MCard id="stow-plan-detail" className="stow-column-card">
      <div className="stow-detail-titlebar">
        <div className="stow-detail-title">
          <h2>方案 #{rank}</h2>
          <div className="stow-detail-verdicts">
            {plan.consumablesOk === false && <VerdictBadge verdict="fail">油水不足</VerdictBadge>}
            <VerdictBadge verdict={plan.stabilityOk ? "pass" : "fail"}>
              稳性 {plan.stabilityOk ? "通过" : "不通过"}
            </VerdictBadge>
            <VerdictBadge verdict={!plan.strengthChecked ? "none" : plan.strengthOk ? "pass" : "fail"}>
              强度 {!plan.strengthChecked ? "未校核" : plan.strengthOk ? "通过" : "不通过"}
            </VerdictBadge>
            {plan.draftOk === false && <VerdictBadge verdict="fail">吃水 超限</VerdictBadge>}
            <VerdictBadge verdict={draftVerdict}>
              {draftVerdict === "fail" ? "✗ 超限" : draftVerdict === "warn" ? "△ 临界" : "约束港"} {draftBindingCall ? `${draftBindingCall.port} · ${draftBindingPhase} ` : ""}裕量{" "}
              {minDraftMargin == null ? "—" : minDraftMargin.toFixed(2)} m
            </VerdictBadge>
            <VerdictBadge verdict="none">
              用舱 {plan.score.tanksUsed} · 未配对 {plan.score.unpairedTanks}
            </VerdictBadge>
          </div>
        </div>
        <div className="stow-detail-actions">
          <MButton
            type="button"
            variant="ghost"
            size="sm"
            icon={ArrowLeft}
            onClick={() =>
              document.getElementById("stow-plan-list")?.scrollIntoView()
            }
          >
            方案列表
          </MButton>
          <MButton
            type="button"
            variant="soft"
            size="sm"
            icon={Download}
            onClick={() => {
              downloadText(EXPORTERS[0].render(plan, rank, ship, voyage));
              try {
                track("export_csv", { rows: plan.stages.reduce((sum, stage) => sum + ship.tanks.length + (stage.floating?.ballastTanks?.length ?? 0) + 1, 0) });
              } catch { /* Statistics must not affect export. */ }
            }}
          >
            导出 CSV
          </MButton>
          <MButton
            type="button"
            size="sm"
            iconRight={ArrowRight}
            onClick={sendToLoadCalc}
            disabled={!stage}
          >
            送到装载计算
          </MButton>
        </div>
      </div>

      <p className="stow-voyage-summary">
        航程 <b>{tonnes(consumables.totalNm)} nm</b> · <b>{consumables.totalDays.toFixed(1)} d</b> · 燃油消耗 <b>{tonnes(consumables.fuelBurnMt)} t</b>
        (最小到港余量 {consumables.minFuelMarginMt == null ? "—" : `${consumables.minFuelMarginMt >= 0 ? "+" : ""}${tonnes(consumables.minFuelMarginMt)}`} t) · 淡水消耗 <b>{tonnes(consumables.fwUsedMt)} t</b>
        (造水 {tonnes(consumables.fwMadeMt)} t,ROB 最低 {consumables.minFwRobMt == null ? "—" : tonnes(consumables.minFwRobMt)} t)
      </p>
      <p className={`stow-precision-status${precision.status === "error" ? " stow-margin-fail" : ""}`} role="status">
        {precision.status === "ready"
          ? "吃水 / GM / SF / BM 数值已精算；通过状态沿用方案初筛，最终以完整装载校核为准。"
          : precision.status === "error"
            ? `${precision.error}；当前显示估算值。`
            : "正在后台精算；当前吃水和裕量为估算值，可继续切换方案或查看舱位。"}
      </p>
      <StageTimeline
        departureDate={voyage.constants?.departureDate}
        stages={timelineStages}
        calls={timelineCalls}
        selected={selectedStageIndex < 0 ? "all" : selectedStageIndex}
        onSelect={(index, navigate = true) => {
          selectCall(index === "all" ? null : (calls[index]?.id ?? null));
          if (navigate) scrollToStowSection("stow-tank-panel");
        }}
        minMarginStage={minMarginStage}
      />

      <div className="stow-detail-body">
        <section id="stow-tank-panel" className="stow-detail-panel">
          <div className="stow-detail-panel-head">
            <h3>
              舱位图 ·{" "}
              {stageLabel}
            </h3>
            <span>
              舱格：舱号 / 票号 / 货名 / 装卸港 / 装载率；船首在右
            </span>
          </div>
          {stage && stage.totalWeight === 0 && (stage.emptiedCargoTanks?.length ?? 0) > 0 && (
            <p className="stow-tank-note">本站卸货后，货舱已卸空。</p>
          )}
          <TankGrid
            ship={ship}
            stage={stage}
            stages={plan.stages}
            ballastTanks={stage?.floating?.ballastTanks}
            allocations={plan.allocations}
            voyage={voyage}
            visuals={visuals}
            stageLabel={stageLabel}
          />
          <p className="stow-tank-note">
            左右滑动查看全部舱位，点击舱格查看重量、体积及完整泊位。底边表示装载率；WB 行为压载率。
            {!stage && " 总览展示各舱最后一票分配，压载展示逐舱最高值，不代表同一时点。"}
          </p>

          {stageConsumables && (
            <section aria-label="本站航程" className="stage-voyage-panel">
              <h3>本站航程 · 第 {selectedStageIndex + 1} 站 {selectedCall?.port || "未填港口"}</h3>
              <KvList
                className="stow-stage-voyage-kv"
                items={[
                  { label: "航段", value: `${tonnes(stageConsumables.legNm)} nm · ${stageConsumables.legDays.toFixed(1)} d` },
                  { label: "油耗(航段)", value: `${tonnes(stageConsumables.legFuelMt)} t` },
                  { label: "港内", value: `${(stageConsumables.portDays * 24).toFixed(0)} h · 油耗 ${tonnes(stageConsumables.portFuelMt)} t` },
                  { label: "加油 / 加水", value: <>{stageConsumables.bunkerMt > 0 ? <b>+{tonnes(stageConsumables.bunkerMt)}</b> : "—"} / {stageConsumables.freshWaterTakeMt > 0 ? <b>+{tonnes(stageConsumables.freshWaterTakeMt)}</b> : "—"}</> },
                  { label: "到港 ROB", value: `燃油 ${tonnes(stageConsumables.arrival.fuelMt)} · 淡水 ${tonnes(stageConsumables.arrival.freshWaterMt)}` },
                  { label: "离港 ROB", value: `燃油 ${tonnes(stageConsumables.departure.fuelMt)} · 淡水 ${tonnes(stageConsumables.departure.freshWaterMt)}` },
                  { label: "安全余量", value: `${tonnes(stageConsumables.reserveMt)} t(${voyage.constants?.bunkerReserveDays ?? DEFAULT_CONSTANTS.bunkerReserveDays} d)` },
                  { label: "ETA / ETD", value: `${day(stageConsumables.etaDay)} / ${day(stageConsumables.etdDay)}` },
                ]}
              />
            </section>
          )}

          {stage && precise && (
            <details className="stow-precise" onToggle={event => { if (event.currentTarget.open) track("precise_open"); }}>
              <summary>本站离港精算明细</summary>
              <div className="stow-precise-body">
                <KvList
                  className="stow-stage-metrics"
                  items={[
                    {
                      label: "排水量",
                      value: `${precise.displacement.toFixed(1)} MT`,
                    },
                    {
                      label: "艏 / 艉吃水",
                      value: `${precise.draftFwd.toFixed(2)} / ${precise.draftAft.toFixed(2)} m`,
                    },
                    { label: "纵倾", value: `${precise.trim.toFixed(2)} m` },
                    { label: "水密度", value: precise.waterDensity.toFixed(3) },
                    {
                      label: "限制 / 裕量",
                      value:
                        precise.maxDraftM == null
                          ? "不限"
                          : `${precise.maxDraftM.toFixed(2)} / ${precise.draftMargin!.toFixed(2)} m`,
                    },
                    {
                      label: "纵倾可换裕量",
                      value: precise.maxDraftM == null
                        ? "不限"
                        : precise.trimRelaxed
                          ? `已放宽至平吃水(纵倾 ${precise.trim.toFixed(2)} m)`
                          : `≈ ${(precise.trimReliefM ?? 0).toFixed(2)} m`,
                    },
                    {
                      label: "GM 修正后",
                      value: `${precise.gmCorrected.toFixed(3)} m`,
                    },
                    {
                      label: "自动配平",
                      value: precise.ok ? "达成" : "未达成",
                    },
                    { label: "剪力 SF", value: stagePercentage(precise.sfPct) },
                    { label: "弯矩 BM", value: stagePercentage(precise.bmPct) },
                    {
                      label: "压载舱 / 吨数",
                      value: precise.ballastTanks.length
                        ? precise.ballastTanks
                            .map(
                              tank => `${tank.id} ${tank.weight.toFixed(0)} t`
                            )
                            .join(" · ")
                        : "无压载",
                    },
                  ]}
                />
                <p className="stow-precise-note">
                  完整自动配平已计入空船、航次常数、该站离港货物与压载舱重心。
                </p>
                {!precise.ok &&
                  precise.notes.map(note => (
                    <p className="stow-ballast-note" key={note}>
                      {note}
                    </p>
                  ))}

                {stage && precise && (
                  <section className="stow-damage-check">
                    <div className="stow-damage-heading">
                      <h3>破舱校核</h3>
                      <MButton
                        type="button"
                        size="sm"
                        onClick={runDamageCheck}
                        disabled={damageRunning}
                      >
                        {damageRunning
                          ? `校核中 ${damageProgress?.completed ?? 0} / ${damageProgress?.total ?? damageCases.length}`
                          : "破舱校核"}
                      </MButton>
                    </div>
                    {damageRunning && damageProgress && (
                      <div className="stow-damage-progress" aria-live="polite">
                        <progress
                          value={damageProgress.completed}
                          max={damageProgress.total}
                        />
                        <strong>
                          {damageProgress.completed} / {damageProgress.total}
                        </strong>
                      </div>
                    )}
                    {stageDamage && stageWorst && (
                      <div
                        className={
                          stageDamage.pass
                            ? "stow-damage-result stow-damage-pass"
                            : "stow-damage-result stow-damage-fail"
                        }
                      >
                        <strong>
                          {stageDamage.pass ? "✓ 通过" : "✗ 不通过"}
                        </strong>
                        <span>
                          最不利工况 {stageWorst.case.id} ·{" "}
                          {stageWorst.case.label} ·{" "}
                          {stageWorst.case.compartments.join(" + ")}
                        </span>
                      </div>
                    )}
                  </section>
                )}

                {stage && stageCriteria && (
                  <section className="stow-stability-summary">
                    <h3>2.2 稳性衡准（快速估算）</h3>
                    <div className="stow-stability-criteria">
                      {stageCriteria.map(criterion => (
                        <div key={criterion.id}>
                          <span>
                            {criterion.id} · {criterion.name}
                          </span>
                          <small>{criterion.actual}</small>
                          <strong
                            className={
                              criterion.pass
                                ? "stow-stability-pass"
                                : "stow-stability-fail"
                            }
                          >
                            {criterion.pass ? "✓" : "✗"}
                          </strong>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            </details>
          )}
        </section>

        <aside className="stow-detail-side">
          <section className="stow-detail-panel">
            <div className="stow-detail-panel-head">
              <h3>票货分配</h3>
            </div>
            <ParcelLegend
              parcels={voyage.parcels}
              allocations={plan.allocations}
            visuals={visuals}
              calls={calls}
              ship={ship}
              intake={plan.intake}
            />
          </section>

          {plan.advisories.length > 0 && (
            <section className="stow-detail-panel stow-advice-card">
              <div className="stow-detail-panel-head">
                <h3>提示 · {plan.advisories.length}</h3>
                <VerdictBadge verdict="warn">注意</VerdictBadge>
              </div>
              {plan.advisories.map((advisory, index) => (
                <div
                  className="stow-advice"
                  key={`${advisory.tankId}-${advisory.ballastId}-${index}`}
                >
                  <strong>
                    {advisory.tankId} · {advisory.ballastId}
                  </strong>
                  <p>{advisory.message}</p>
                  <small>建议：压载操作前复核货温与保温安排。</small>
                </div>
              ))}
            </section>
          )}
        </aside>
      </div>
    </MCard>
  );
}
