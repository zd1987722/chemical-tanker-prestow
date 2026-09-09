import { useEffect, useState } from "react";
import { track } from "@/lib/track";
import { AlertTriangle, Download, FileDown, ListChecks, Loader2 } from "lucide-react";
import { draftMarginVerdict } from "./presentation";
import { focusValidationTarget } from "./validation";
import { Empty, MButton, MCard, SectionTitle } from "@/components/maritime";
import { downloadText } from "@/lib/prestow/download";
import { planFeasible } from "@/lib/prestow/engine";
import { EXPORTERS, renderSummaryCsv } from "@/lib/prestow/export";
import type { RepairProposal, RepairReport, StowResult, StowShip, StowVoyage } from "@/lib/prestow/types";

function formatMt(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function PlanList({
  result,
  solving,
  onCancel,
  selectedKey,
  onSelect,
  exportN,
  rejectedCount = 0,
  showRejected = false,
  onToggleRejected,
  onExportN,
  ship,
  voyage,
  repairs = null,
  repairing = false,
  onApplyRepair,
  onLoadSample,
  onSolve,
  canSolve,
}: {
  result: StowResult | null;
  solving: boolean;
  onCancel(): void;
  repairs?: RepairReport | null;
  repairing?: boolean;
  onApplyRepair?(proposal: RepairProposal): void;
  /** 空状态引导:一键载入示例航次 */
  onLoadSample?(): void;
  onSolve(): void;
  canSolve: boolean;
  selectedKey: string | null;
  onSelect(key: string): void;
  exportN: number;
  rejectedCount?: number;
  showRejected?: boolean;
  onToggleRejected?(value: boolean): void;
  onExportN(value: number): void;
  ship: StowShip;
  voyage: StowVoyage;
}) {
  const [visibleCount, setVisibleCount] = useState(20);

  useEffect(() => setVisibleCount(20), [result]);

  if (solving) {
    return (
      <MCard id="stow-plan-list" className="stow-column-card" aria-busy="true">
        <SectionTitle>方案列表</SectionTitle>
        <div className="stow-solve-progress" role="status">
          <Loader2 size={20} className="animate-spin" />
          <div><strong>正在生成方案</strong><p>正在检查舱容、相容性及逐港约束，复杂航次需要更多时间。</p></div>
          <MButton type="button" variant="soft" size="sm" onClick={onCancel}>取消计算</MButton>
        </div>
      </MCard>
    );
  }

  if (result === null) {
    return (
      <MCard id="stow-plan-list" className="stow-column-card">
        <SectionTitle>方案列表</SectionTitle>
        <div className="stow-empty">
          <Empty icon={ListChecks}
            title={voyage.calls.length || voyage.parcels.length ? "航次已录入，等待生成方案" : "载入示例或录入航次"}
            sub={voyage.calls.length || voyage.parcels.length
              ? `当前 ${voyage.calls.length} 个停靠点、${voyage.parcels.length} 票货，生成后查看可用方案。`
              : "可先载入一个 8 港 12 票的示例，了解完整流程。"}>
            {voyage.calls.length || voyage.parcels.length ? (
              <MButton type="button" size="sm" onClick={onSolve} disabled={!canSolve}>生成方案</MButton>
            ) : onLoadSample && (
              <MButton type="button" variant="soft" size="sm" onClick={onLoadSample}>载入示例航次</MButton>
            )}
          </Empty>
        </div>
      </MCard>
    );
  }

  if (result.status === "invalid") {
    return (
      <MCard id="stow-plan-list" className="stow-column-card">
        <SectionTitle>方案列表</SectionTitle>
        <div className="stow-result-banner stow-result-danger" role="alert">
          <AlertTriangle size={16} />
          <strong>输入数据未通过校验</strong>
        </div>
        <ul className="stow-error-list">
          {result.errors.map((error, index) => (
            <li key={`${error}-${index}`} id={`stow-error-${index}`}>
              <span>{error}</span>
              {result.issues?.[index]?.target && (
                <button type="button" className="stow-error-link" aria-label={`定位输入：${error}`} onClick={() => focusValidationTarget(result.issues![index].target)}>定位输入</button>
              )}
            </li>
          ))}
        </ul>
      </MCard>
    );
  }

  const rejectionText = result.rejectedByDraft
    ? `另有 ${result.rejectedByDraft} 个方案因吃水超限剔除`
    : null;
  const bannerMessage = rejectionText
    ? result.message.replace(new RegExp(`；?${rejectionText}$`), "")
    : result.message;
  const resultMessages = [bannerMessage, rejectionText].filter(Boolean);
  const callById = new Map(voyage.calls.map(call => [call.id, call]));
  const parcelById = new Map(voyage.parcels.map(parcel => [parcel.id, parcel]));
  const visiblePlans = result.plans.slice(0, visibleCount);

  return (
    <MCard id="stow-plan-list" className="stow-column-card">
      <div className="stow-plan-heading">
        <SectionTitle>方案列表 · 可用 {result.plans.filter(planFeasible).length}</SectionTitle>
        {rejectedCount > 0 && onToggleRejected && (
          <label className="stow-show-rejected">
            <input
              type="checkbox"
              checked={showRejected}
              onChange={event => onToggleRejected(event.target.checked)}
            />
            显示不合格方案({rejectedCount})
          </label>
        )}
      </div>

      <div
        className={
          "stow-result-line" +
          (result.status === "truncated" || rejectionText
            ? " stow-result-warning"
            : "")
        }
      >
        <div className="stow-result-copy">
          {(result.status === "truncated" || rejectionText) && (
            <AlertTriangle size={15} />
          )}
          <span>{resultMessages.join(" · ")}</span>
        </div>
      </div>
        {result.plans.length > 0 && (
          <div className="stow-export-toolbar">
            <label>
              <span>导出数量</span>
              <input
                type="number"
                min="1"
                max={result.plans.length}
                value={Math.min(exportN, result.plans.length)}
                aria-label="导出方案数"
                onChange={event =>
                  onExportN(
                    Math.min(result.plans.length, Math.max(1, Number(event.target.value) || 1))
                  )
                }
              />
            </label>
            <MButton
              type="button"
              variant="soft"
              size="sm"
              icon={Download}
              onClick={() => {
                result.plans
                  .slice(0, exportN)
                  .forEach((plan, index) =>
                    downloadText(
                      EXPORTERS[0].render(plan, index + 1, ship, voyage)
                    )
                  );
                try {
                  track("export_csv", { rows: result.plans.slice(0, exportN).reduce((sum, plan) => sum + plan.stages.reduce((rows, stage) => rows + ship.tanks.length + (stage.floating?.ballastTanks?.length ?? 0) + 1, 0), 0) });
                } catch { /* Statistics must not affect export. */ }
              }}
              title="浏览器可能询问是否允许下载多个文件"
            >
              导出前 N 个
            </MButton>
            <MButton
              type="button"
              variant="ghost"
              size="sm"
              icon={FileDown}
              onClick={() => { downloadText(renderSummaryCsv(result, ship, voyage)); track("export_csv", { rows: result.plans.length }); }}
            >
              汇总 CSV
            </MButton>
          </div>
        )}

      {result.intakeSummary && result.intakeSummary.length > 0 && (
        <div className="stow-intake-summary">
          <strong>最大装载量</strong>
          <div className="stow-summary-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>货</th>
                  <th>吨数</th>
                  <th>受限于</th>
                </tr>
              </thead>
              <tbody>
                {result.intakeSummary.map(item => (
                  <tr key={item.parcelId}>
                    <td>
                      {parcelById.get(item.parcelId)?.display ?? item.parcelId}
                    </td>
                    <td>{item.quantityMt.toFixed(1)} MT</td>
                    <td>{item.limitedBy}{item.consumptionCreditMt != null ? `;到港前油水消耗 ${item.consumptionCreditMt.toFixed(0)} t 已计入可装量` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {result.plans.length === 0 ? (
        <div className="stow-zero-result stow-empty">
          <Empty icon={AlertTriangle} title="未找到满足约束的方案" />
          {result.diagnosis && (
            <>
              <ul className="stow-diagnosis">
                {result.diagnosis.reasons.map((reason, index) => (
                  <li key={`${reason.code}-${index}`} data-severity={reason.severity}>
                    <strong>{{ blocker: "阻断", likely: "很可能", hint: "提示" }[reason.severity]}</strong>{" "}
                    {reason.message}
                    {reason.target && <button type="button" className="stow-error-link" onClick={() => focusValidationTarget(reason.target!)}>查看该港设置</button>}
                  </li>
                ))}
              </ul>
              {result.diagnosis.suggestions.length > 0 && (
                <p className="stow-diagnosis-suggestions">建议：{result.diagnosis.suggestions.join(" · ")}</p>
              )}
            </>
          )}
          {(repairing || repairs) && (
            <div className="stow-repair">
              <div className="stow-repair-head">
                修改建议
                {repairing && <small>正在寻找只改吨数就可行的方案…</small>}
                {!repairing && repairs && repairs.proposals.length > 0 && (
                  <small>已复核 {repairs.tried} 个候选,{(repairs.elapsedMs / 1000).toFixed(1)} s;按少装吨数排序</small>
                )}
              </div>
              {!repairing && repairs && repairs.proposals.length > 0 && (
                <ul className="stow-repair-list">
                  {repairs.proposals.map(proposal => (
                    <li className="stow-repair-item" key={proposal.id}>
                      <strong>{proposal.title}</strong>
                      <ul className="stow-repair-changes">
                        {proposal.changes.map(change => (
                          <li key={change.parcelId}>
                            <span className="stow-repair-nm">{change.display}</span>
                            <span className="stow-repair-q">
                              {change.kind === "drop"
                                ? <>{formatMt(change.fromMt)} t → <b>删除</b></>
                                : <>{formatMt(change.fromMt)} → {formatMt(change.toMt)} t(<b>−{formatMt(change.fromMt - change.toMt)}</b>)</>}
                            </span>
                            {change.note && <small>{change.note}</small>}
                          </li>
                        ))}
                      </ul>
                      <div className="stow-repair-foot">
                        <span>{proposal.message} · 已复核可行</span>
                        {onApplyRepair && (
                          <MButton type="button" size="sm" onClick={() => onApplyRepair(proposal)}>
                            应用并重新生成
                          </MButton>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {!repairing && repairs && repairs.proposals.length === 0 && (
                <p className="stow-repair-note">{repairs.note ?? "未找到只改吨数就可行的方案"}</p>
              )}
            </div>
          )}
          {result.conflictPairs.length > 0 && (
            <details className="stow-diagnosis-conflicts">
              <summary>不相容货对({result.conflictPairs.length})</summary>
            <ul>
              {result.conflictPairs.map(([left, right], index) => (
                <li key={`${left}-${right}-${index}`}>
                  以下货对不能相邻：{left} ↔ {right}
                </li>
              ))}
            </ul>
            </details>
          )}
        </div>
      ) : (
        <>
          <div className="stow-plan-table-wrap">
            <table className="stow-plan-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>稳性</th>
                  <th>强度</th>
                  <th>吃水裕量 · 估算</th>
                  <th>燃油余量</th>
                  <th className="stow-number">用舱</th>
                  <th className="stow-number">提示数</th>
                  <th className="stow-number">LCG 偏移</th>
                </tr>
              </thead>
              <tbody>
                {visiblePlans.map((plan, index) => {
                  const bindingCall = plan.bindingCallId
                    ? callById.get(plan.bindingCallId)
                    : undefined;
                  const margin = plan.score.minDraftMargin;
                  const selected = plan.key === selectedKey;
                  return (
                    <tr
                      key={plan.key}
                      className={[
                        selected && "stow-plan-selected",
                        !planFeasible(plan) && "stow-plan-rejected",
                      ].filter(Boolean).join(" ") || undefined}
                      onClick={() => { onSelect(plan.key); track("plan_select", { rank: index + 1 }); }}
                      onKeyDown={event => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onSelect(plan.key);
                          track("plan_select", { rank: index + 1 });
                        }
                      }}
                      tabIndex={0}
                      aria-current={selected ? "true" : undefined}
                    >
                      <td className="stow-number">{index + 1}</td>
                      <td>
                        <span
                          className={
                            plan.stabilityOk
                              ? "stow-stability-pass"
                              : "stow-stability-fail"
                          }
                        >
                          {plan.stabilityOk ? "✓" : "✗"}
                        </span>{" "}
                        GM {plan.score.minGm.toFixed(2)}
                      </td>
                      <td>
                        {plan.strengthChecked ? (
                          <>
                            <span
                              className={
                                plan.strengthOk
                                  ? "stow-strength-pass"
                                  : "stow-strength-fail"
                              }
                            >
                              {plan.strengthOk ? "✓" : "✗"}
                            </span>{" "}
                            BM {plan.score.maxBmPct.toFixed(1)}%
                          </>
                        ) : (
                          <span className="s-muted">强度 未校核</span>
                        )}
                      </td>
                      <td className={`stow-margin-${draftMarginVerdict(margin)}`}>
                        {draftMarginVerdict(margin) === "fail" ? "✗ 超限 " : draftMarginVerdict(margin) === "warn" ? "△ 临界 " : ""}
                        {bindingCall && Number.isFinite(margin)
                          ? `${margin!.toFixed(2)} m @ ${bindingCall.port}`
                          : "—"}
                      </td>
                      <td className={(plan.score.minBunkerMarginMt ?? 0) < 0 ? "stow-stability-fail" : undefined}>{plan.score.minBunkerMarginMt == null ? "—" : `${plan.score.minBunkerMarginMt.toFixed(0)} t`}</td>
                      <td className="stow-number">{plan.score.tanksUsed}</td>
                      <td className="stow-number">{plan.score.advisoryCount}</td>
                      <td className="stow-number">
                        {plan.score.maxLcgShift.toFixed(1)} m
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {visibleCount < result.plans.length && (
            <MButton
              type="button"
              variant="ghost"
              size="sm"
              className="stow-show-more"
              onClick={() => setVisibleCount(count => count + 20)}
            >
              显示更多
            </MButton>
          )}
          <p className="stow-estimate-note">
            * 估算值，仅用于排序，以 Loadicator 为准
          </p>
        </>
      )}
    </MCard>
  );
}
