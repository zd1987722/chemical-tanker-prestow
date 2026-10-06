import { useEffect, useMemo, useRef, useState } from "react";
import { track } from "@/lib/track";
import type { SolveTrackProps } from "@shared/track";
import { ConstantsPanel } from "@/components/prestow/ConstantsPanel";
import { ParcelTable } from "@/components/prestow/ParcelTable";
import { PlanDetail } from "@/components/prestow/PlanDetail";
import { PlanList } from "@/components/prestow/PlanList";
import { ScenarioPanel } from "@/components/prestow/ScenarioPanel";
import { StowTitleBar } from "@/components/prestow/StowTitleBar";
import { usePrestowDraft } from "@/components/prestow/usePrestowDraft";
import { VoyageForm } from "@/components/prestow/VoyageForm";
import { draftIssues } from "@/components/prestow/validation";
import { useAppendixIExceptionStatus } from "@/lib/appendix-i-exceptions";
import { DEMO_STOW_SHIP } from "@/lib/prestow/demo-ship";
import { createSolver, SolverCancelled, type Solver } from "@/lib/prestow/solve-client";
import { planFeasible } from "@/lib/prestow/engine";
import { findSampleVoyage } from "@/lib/prestow/sample-voyages";
import { clearSolveCache, readSolveCache, voyageKey, writeSolveCache } from "@/lib/prestow/result-cache";
import type { RepairProposal, RepairReport, StowResult, StowVoyage } from "@/lib/prestow/types";
import { INFEASIBILITY_LABELS } from "@/lib/prestow/types";
import { parcelVisualMap, scrollToStowSection } from "@/components/prestow/presentation";

export default function Prestow() {
  const { voyage, setVoyage, reset } = usePrestowDraft();
  const [cachedSolve] = useState(() => readSolveCache(voyage));
  const [result, setResult] = useState<StowResult | null>(() => cachedSolve?.result ?? null);
  const [selectedKey, setSelectedKey] = useState<string | null>(() => cachedSolve?.selectedKey ?? null);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(() => cachedSolve?.selectedCallId ?? null);
  const [solving, setSolving] = useState(false);
  const [exportN, setExportN] = useState(() => cachedSolve?.exportN ?? 20);
  const [showRejected, setShowRejected] = useState(() => cachedSolve?.showRejected ?? false);
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [incomingFile, setIncomingFile] = useState<File | null>(null);
  const [repairs, setRepairs] = useState<{ running: boolean; report: RepairReport | null }>(() => ({ running: false, report: cachedSolve?.repairs ?? null }));
  const repairRun = useRef(0);
  const scenarioPanel = useRef<HTMLDivElement>(null);
  const sampleAutoLoadAttempted = useRef(false);
  const solver = useRef<Solver | null>(null);
  const getSolver = () => (solver.current ??= createSolver());
  useEffect(() => () => solver.current?.dispose(), []);
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => getSolver().warm());
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(() => getSolver().warm(), 1200);
    return () => window.clearTimeout(id);
  }, []);
  useEffect(() => {
    if (result) {
      writeSolveCache({ voyageKey: voyageKey(voyage), result, selectedKey, selectedCallId, showRejected, exportN, repairs: repairs.report });
    } else {
      clearSolveCache();
    }
  }, [result, selectedKey, selectedCallId, showRejected, exportN, repairs.report, voyage]);
  const appendixStatus = useAppendixIExceptionStatus();
  const visuals = useMemo(() => parcelVisualMap(voyage.parcels), [voyage.parcels]);

  useEffect(() => {
    if (sampleAutoLoadAttempted.current) return;
    sampleAutoLoadAttempted.current = true;
    if (voyage.calls.length > 0) return;
    const sampleId = new URLSearchParams(window.location.search).get("sample");
    const entry = sampleId ? findSampleVoyage(sampleId) : undefined;
    if (entry) {
      setVoyage(structuredClone(entry.voyage));
      track("sample_load", { id: entry.id });
    }
  }, [setVoyage, voyage.calls.length]);

  const changeVoyage = (
    update: StowVoyage | ((previous: StowVoyage) => StowVoyage)
  ) => {
    setVoyage(update);
    setResult(null);
    setSelectedKey(null);
    repairRun.current++;
    setRepairs({ running: false, report: null });
    getSolver().cancel();
    setSolving(false);
  };

  const runSolve = (target: StowVoyage) => {
    if (appendixStatus !== "loaded") return;
    setSolving(true);
    getSolver().cancel();
    setResult(null);
    setSelectedKey(null);
    repairRun.current++;
    setRepairs({ running: false, report: null });
    scrollToStowSection("stow-plan-list");
    const startedAt = Date.now();
    getSolver().solve(target).then(next => {
      const voyage = target;
      try {
        track("solve", {
          calls: voyage.calls.length, parcels: voyage.parcels.length,
          plans: next.status === "invalid" ? 0 : next.plans.length,
          rejected: next.status === "invalid" ? 0 : (next.rejectedByDraft ?? 0) + next.plans.filter(plan => !planFeasible(plan)).length,
          ms: Date.now() - startedAt, status: next.status,
          ...(next.status === "invalid" ? { error: next.errors[0]?.slice(0, 80) } : {}),
          reason: next.status === "invalid" ? "invalid" : next.plans.length === 0 ? (next.diagnosis?.reasons[0]?.code ?? "unknown") : "",
        } satisfies SolveTrackProps);
      } catch { /* 统计不能影响求解。 */ }
      setResult(next);
      setSelectedKey(
        next.status !== "invalid" ? (next.plans.find(planFeasible)?.key ?? null) : null
      );
      setSolving(false);
      // 0 方案:后台寻找修改方案(减量 / 删票),复核可行后展示
      const run = ++repairRun.current;
      if (next.status !== "invalid" && next.plans.length === 0) {
        setRepairs({ running: true, report: null });
        getSolver().repair(target, next.diagnosis).then(report => {
          if (repairRun.current === run) setRepairs({ running: false, report });
        }).catch(error => {
          if (repairRun.current === run && !(error instanceof SolverCancelled)) setRepairs({ running: false, report: { proposals: [], tried: 0, elapsedMs: 0, note: "修改建议计算失败" } });
        });
      } else {
        setRepairs({ running: false, report: null });
      }
    }).catch(error => {
      if (error instanceof SolverCancelled) return;
      setResult({ status: "invalid", errors: [`求解出错:${error instanceof Error ? error.message : String(error)}`] });
      setSolving(false);
    });
  };
  const solve = () => runSolve(voyage);
  const cancelSolve = () => { getSolver().cancel(); setSolving(false); };
  const loadSample = (id: string) => {
    const entry = findSampleVoyage(id);
    if (!entry) return;
    changeVoyage(structuredClone(entry.voyage));
    track("sample_load", { id });
  };
  const applyRepair = (proposal: RepairProposal) => {
    try {
      track("repair_apply", { changes: proposal.changes.length, removedMt: Math.round(proposal.removedMt), origin: proposal.origin });
    } catch { /* Statistics must not affect the page. */ }
    setVoyage(proposal.voyage);
    setResult(null);
    setSelectedKey(null);
    setUnresolved([]);
    runSolve(proposal.voyage);
  };

  // 吃水/稳性/强度/油水不合格的方案默认不列出(引擎已把它们排在最后);勾选「显示不合格方案」才接在可行方案之后
  const rejectedCount =
    result && result.status !== "invalid" ? result.plans.filter(plan => !planFeasible(plan)).length : 0;
  const viewResult: StowResult | null = useMemo(
    () => result && result.status !== "invalid" && result.plans.some(plan => !planFeasible(plan))
      ? { ...result, plans: showRejected ? result.plans : result.plans.filter(planFeasible) }
      : result,
    [result, showRejected],
  );
  const selected =
    viewResult && viewResult.status !== "invalid"
      ? (viewResult.plans.find(plan => plan.key === selectedKey) ?? viewResult.plans[0] ?? null)
      : null;
  const solvedIntake =
    selected?.intake ??
    (result && result.status !== "invalid"
      ? result.plans[0]?.intake
      : undefined);

  const clear = () => {
    // 先作废所有后台任务(求解 / 修改建议),避免旧航次结果回填到清空后的表单
    getSolver().cancel();
    repairRun.current++;
    setRepairs({ running: false, report: null });
    setSolving(false);
    reset();
    setResult(null);
    setSelectedKey(null);
    setUnresolved([]);
  };
  const resultSummary = result === null
    ? undefined
    : result.status === "invalid"
      ? `${result.errors.length} 项输入错误`
      : `可用 ${result.plans.length - rejectedCount} / 候选 ${result.plans.length}${result.plans.length === 0 && result.diagnosis?.reasons[0] ? ` · ${INFEASIBILITY_LABELS[result.diagnosis.reasons[0].code]}` : ""}`;
  const validationIssues = result?.status === "invalid" ? result.issues ?? [] : [];

  return (
    <div className="page demo-wrap stow-page">
      <StowTitleBar
        solving={solving}
        appendixStatus={appendixStatus}
        onSolve={solve}
        onReset={clear}
        onImportMail={file => {
          setIncomingFile(file);
          scenarioPanel.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
        onLoadSample={loadSample}
        resultSummary={resultSummary}
        voyageSummary={`${voyage.voyageNo || "未命名航次"} · ${voyage.calls.length} 停靠点 · ${voyage.parcels.length} 票货`}
      />

      <div className="stow-grid">
        <div className="stow-column stow-sidebar stow-area-input">
          <div ref={scenarioPanel}>
            <ScenarioPanel
              incomingFile={incomingFile}
              onFileConsumed={() => setIncomingFile(null)}
              onApply={(parsedVoyage, parsedUnresolved) => {
                changeVoyage({ ...parsedVoyage, shipId: DEMO_STOW_SHIP.id });
                const issues = draftIssues(parsedVoyage);
                if (issues.length > 0) setResult({ status: "invalid", errors: issues.map(issue => issue.message), issues });
                setUnresolved(parsedUnresolved);
              }}
            />
          </div>
          <VoyageForm
            issues={validationIssues}
            voyage={voyage}
            onChange={changeVoyage}
            unresolved={unresolved}
          />
          <ConstantsPanel voyage={voyage} onChange={changeVoyage} issues={validationIssues} />
          <ParcelTable
            issues={validationIssues}
            visuals={visuals}
            voyage={voyage}
            onChange={changeVoyage}
            solvedIntake={solvedIntake}
            intakeSummary={result && result.status !== "invalid" ? result.intakeSummary : undefined}
            unresolved={unresolved}
          />
        </div>
        <div className="stow-column stow-area-results">
          <div className="stow-column stow-area-list">
            <PlanList
              onSolve={solve}
              canSolve={appendixStatus === "loaded"}
              solving={solving}
              onCancel={cancelSolve}
              result={viewResult}
              rejectedCount={rejectedCount}
              showRejected={showRejected}
              onToggleRejected={setShowRejected}
              selectedKey={selected?.key ?? null}
              onSelect={key => { setSelectedKey(key); scrollToStowSection("stow-plan-detail"); }}
              exportN={exportN}
              onExportN={setExportN}
              ship={DEMO_STOW_SHIP}
              voyage={voyage}
              repairs={repairs.report}
              repairing={repairs.running}
              onApplyRepair={applyRepair}
              onLoadSample={() => loadSample("far-east-europe-12")}
            />
          </div>
          <div className="stow-column stow-area-detail">
            <PlanDetail
              initialCallId={selectedCallId}
              onCallChange={setSelectedCallId}
              visuals={visuals}
              plan={selected}
              rank={
                selected && viewResult && viewResult.status !== "invalid"
                  ? viewResult.plans.indexOf(selected) + 1
                  : 0
              }
              ship={DEMO_STOW_SHIP}
              voyage={voyage}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
