import { useState, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  ClipboardPenLine,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  ChemSubstancePicker,
  type PickedSubstance,
} from "@/components/ChemSubstancePicker";
import { MButton, MCard, SectionTitle } from "@/components/maritime";
import { trpc } from "@/lib/trpc";
import { validationAttrs } from "./validation";
import type { ValidationIssue, IntakeMode, Parcel, StowVoyage, StowResult } from "@/lib/prestow/types";
import type { ParcelVisuals } from "./presentation";

function makeId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    Date.now().toString(36) + Math.random().toString(36).slice(2)
  );
}

function numberOrZero(value: string): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function optionalNumber(value: string): number | null {
  if (value.trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

const num = (value: unknown): number | null => {
  const number = parseFloat(String(value));
  return Number.isFinite(number) ? number : null;
};

const poly = (value: unknown): boolean =>
  value != null && value !== "" && value !== "null";

export function ParcelTable({
  voyage,
  onChange,
  solvedIntake,
  intakeSummary,
  visuals,
  unresolved = [],
  issues = [],
}: {
  voyage: StowVoyage;
  onChange(update: StowVoyage | ((prev: StowVoyage) => StowVoyage)): void;
  solvedIntake?: Record<string, number>;
  intakeSummary?: Extract<StowResult, { status: "ok" | "truncated" }>["intakeSummary"];
  visuals: ParcelVisuals;
  unresolved?: string[];
  issues?: ValidationIssue[];
}) {
  const utils = trpc.useUtils();
  const [manualRows, setManualRows] = useState<Set<string>>(
    () =>
      new Set(
        voyage.parcels
          .filter(parcel => parcel.productId == null && parcel.name !== "")
          .map(parcel => parcel.id)
      )
  );
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  // 外部整套载入(标题条示例航次 / 邮件解析)后,手填货名的票要保持文本框模式
  const parcelIds = voyage.parcels.map(parcel => parcel.id).join("|");
  useEffect(() => {
    setManualRows(previous => {
      const next = new Set(previous);
      for (const parcel of voyage.parcels) {
        if (parcel.productId == null && parcel.name !== "") next.add(parcel.id);
      }
      return next;
    });
    setExpanded(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcelIds]);
  const calls = [...voyage.calls].sort((a, b) => a.seq - b.seq);
  const callShortLabel = (callId: string) => {
    const call = calls.find(item => item.id === callId);
    if (!call) return "请选择";
    const port = call.port.trim() || "未填港口";
    const berth = call.berth.replace(/泊位/g, "").replace(/\s+/g, "");
    return berth ? `${port}·${berth}` : port;
  };
  const callFullLabel = (callId: string) => {
    const call = calls.find(item => item.id === callId);
    if (!call) return "请选择";
    return `${call.seq + 1}. ${call.port || "未填港口"} · ${call.berth || "未填泊位"}`;
  };

  const patch = (id: string, value: Partial<Parcel>) =>
    onChange(prev => ({
      ...prev,
      parcels: prev.parcels.map(parcel =>
        parcel.id === id ? { ...parcel, ...value } : parcel
      ),
    }));

  const selectSubstance = async (
    parcel: Parcel,
    substance: PickedSubstance | null
  ) => {
    if (!substance) {
      patch(parcel.id, {
        productId: null,
        name: "",
        display: "",
        group: null,
        boilPointC: null,
        meltPointC: null,
        polymerizable: false,
      });
      return;
    }
    setManualRows(previous => {
      const next = new Set(previous);
      next.delete(parcel.id);
      return next;
    });
    patch(parcel.id, {
      productId: substance.productId,
      name: substance.name,
      display: substance.name,
      group: substance.group,
    });
    try {
      const detail = await utils.chem.detail.fetch({
        productId: substance.productId,
      });
      const product = detail.product;
      if (!product) throw new Error("missing product detail");
      patch(parcel.id, {
        boilPointC: num(product.boilPoint),
        meltPointC: num(product.meltPoint),
        polymerizable: poly(product.polyRemark),
      });
    } catch {
      toast.warning("未取到热属性，请手工填写沸点/凝点");
    }
  };

  const addParcel = () => {
    const id = makeId();
    onChange(prev => {
      const sortedCalls = [...prev.calls].sort((a, b) => a.seq - b.seq);
      const parcel: Parcel = {
        id,
        productId: null,
        name: "",
        display: "",
        group: null,
        quantityMt: 0,
        density: 0,
        loadCallId: sortedCalls[0]?.id ?? "",
        dischargeCallId: sortedCalls[sortedCalls.length - 1]?.id ?? "",
        heating: { enabled: false },
        boilPointC: null,
        meltPointC: null,
        polymerizable: false,
        maxAllowedTempC: null,
      };
      return { ...prev, parcels: [...prev.parcels, parcel] };
    });
  };

  const toggleExpanded = (id: string) => {
    setExpanded(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const removeParcel = (id: string) => {
    setExpanded(previous => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
    setManualRows(previous => {
      const next = new Set(previous);
      next.delete(id);
      return next;
    });
    onChange(prev => ({
      ...prev,
      parcels: prev.parcels.filter(item => item.id !== id),
    }));
  };

  return (
    <MCard className="stow-section" tabIndex={-1} {...validationAttrs(issues, { section: "parcels" })}>
      <SectionTitle sub="热属性会在选货后自动快照，并可按本航次修订。">
        货票
      </SectionTitle>

      <div className="stow-parcel-list">
        <div className="stow-parcel-row stow-parcel-row-head" aria-hidden="true">
          <div className="stow-parcel-row-primary">
            <span />
            <span>货名</span>
            <span>吨数</span>
            <span>意向</span>
            <span />
          </div>
          <div className="stow-parcel-row-route">
            <span />
            <span>装港</span>
            <span>→</span>
            <span>卸港</span>
          </div>
        </div>
        {voyage.parcels.map((parcel, index) => {
          const manual =
            manualRows.has(parcel.id) ||
            (parcel.productId == null && parcel.name !== "");
          const unresolvedItems = unresolved.filter(
            item =>
              (parcel.display !== "" && item.includes(parcel.display)) ||
              (parcel.name !== "" && item.includes(parcel.name))
          );
          const hasUnresolved = unresolvedItems.length > 0;
          const intakeResult = intakeSummary?.find(item => item.parcelId === parcel.id);
          const field = (name?: string) => validationAttrs(issues, { section: "parcels", index, field: name });
          const intakeMode = parcel.intake?.mode ?? "fixed";
          const isExpanded = expanded.has(parcel.id);
          const setIntakeMode = (mode: IntakeMode) => {
            if (mode === "priority") {
              patch(parcel.id, { intake: { mode, priority: 1 } });
            } else if (mode === "ratio") {
              patch(parcel.id, { intake: { mode, ratio: 1 } });
            } else if (mode === "range") {
              patch(parcel.id, { intake: { mode, minMt: 0, maxMt: 0 } });
            } else {
              patch(parcel.id, { intake: { mode } });
            }
          };
          const picked: PickedSubstance | null =
            parcel.productId == null
              ? null
              : {
                  productId: parcel.productId,
                  name: parcel.name,
                  cas: null,
                  un: null,
                  group: parcel.group,
                };

          return (
            <section
              className={
                "stow-parcel-item" +
                (hasUnresolved ? " stow-unresolved-block" : "")
              }
              key={parcel.id}
              tabIndex={-1}
              {...field()}
            >
              <div className="stow-parcel-row">
                <div className="stow-parcel-row-primary">
                  <span
                    className="stow-parcel-dot"
                    style={{ background: visuals[parcel.id].color }}
                    title={visuals[parcel.id].label}
                  >{String(index + 1).padStart(2, "0")}</span>
                  <div
                    className="stow-parcel-name"
                    title={parcel.display || parcel.name}
                  >
                    {manual ? (
                      <input
                        aria-label={`票货 ${index + 1} 货名`}
                        title={parcel.display || parcel.name}
                        value={parcel.display}
                        onChange={event =>
                          patch(parcel.id, {
                            name: event.target.value,
                            display: event.target.value,
                          })
                        }
                        placeholder="手工填写货名"
                      />
                    ) : (
                      <ChemSubstancePicker
                        value={picked}
                        onSelect={substance =>
                          selectSubstance(parcel, substance)
                        }
                        placeholder="搜索货物名称…"
                      />
                    )}
                  </div>
                  <input
                    {...field("quantityMt")}
                    aria-label={`票货 ${index + 1} 数量（MT）`}
                    type={intakeMode === "fixed" ? "number" : "text"}
                    min={intakeMode === "fixed" ? "0" : undefined}
                    value={
                      intakeMode === "fixed"
                        ? parcel.quantityMt
                        : (solvedIntake?.[parcel.id]?.toFixed(1) ?? "—")
                    }
                    readOnly={intakeMode !== "fixed"}
                    onChange={event =>
                      patch(parcel.id, {
                        quantityMt: numberOrZero(event.target.value),
                      })
                    }
                  />
                  <select
                    aria-label={`票货 ${index + 1} 装载意向`}
                    value={intakeMode}
                    onChange={event =>
                      setIntakeMode(event.target.value as IntakeMode)
                    }
                  >
                    <option value="fixed">固定</option>
                    <option value="priority">优先</option>
                    <option value="ratio">比例</option>
                    <option value="range">范围</option>
                  </select>
                  <button
                    type="button"
                    className="stow-icon-button stow-parcel-toggle"
                    onClick={() => toggleExpanded(parcel.id)}
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? "收起" : "展开"}票货 ${index + 1}`}
                    title={isExpanded ? "收起详情" : "展开详情"}
                  >
                    {isExpanded ? (
                      <ChevronDown size={14} />
                    ) : (
                      <ChevronRight size={14} />
                    )}
                  </button>
                </div>
                <div className="stow-parcel-row-route">
                  <span aria-hidden="true" />
                  <select
                    {...field("loadCallId")}
                    aria-label={`票货 ${index + 1} 装泊位`}
                    title={callFullLabel(parcel.loadCallId)}
                    value={parcel.loadCallId}
                    onChange={event =>
                      patch(parcel.id, { loadCallId: event.target.value })
                    }
                  >
                    <option value="">请选择</option>
                    {calls.map(call => (
                      <option
                        key={call.id}
                        value={call.id}
                        title={callFullLabel(call.id)}
                      >
                        {callShortLabel(call.id)}
                      </option>
                    ))}
                  </select>
                  <span className="stow-parcel-route-arrow" aria-hidden="true">
                    →
                  </span>
                  <select
                    {...field("dischargeCallId")}
                    aria-label={`票货 ${index + 1} 卸泊位`}
                    title={callFullLabel(parcel.dischargeCallId)}
                    value={parcel.dischargeCallId}
                    onChange={event =>
                      patch(parcel.id, {
                        dischargeCallId: event.target.value,
                      })
                    }
                  >
                    <option value="">请选择</option>
                    {calls.map(call => (
                      <option
                        key={call.id}
                        value={call.id}
                        title={callFullLabel(call.id)}
                      >
                        {callShortLabel(call.id)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {intakeResult && <p className="stow-panel-note">{intakeResult.limitedBy}{intakeResult.consumptionCreditMt != null ? `;到港前油水消耗 ${intakeResult.consumptionCreditMt.toFixed(0)} t 已计入可装量` : ""}</p>}
              {isExpanded && (
                <div className="stow-parcel-expand">
                  <strong className="stow-parcel-expand-title">
                    热属性快照与装载约束
                  </strong>
                  {manual ? (
                    <label className="stow-field">
                      <span>USCG 族</span>
                      <input
                        type="number"
                        value={parcel.group ?? ""}
                        onChange={event =>
                          patch(parcel.id, {
                            group: optionalNumber(event.target.value),
                          })
                        }
                        placeholder="未知"
                      />
                    </label>
                  ) : (
                    <div className="stow-parcel-action-field">
                      <span>货物录入</span>
                      <MButton
                        type="button"
                        variant="soft"
                        size="sm"
                        icon={ClipboardPenLine}
                        onClick={() =>
                          setManualRows(previous =>
                            new Set(previous).add(parcel.id)
                          )
                        }
                      >
                        手填货名
                      </MButton>
                    </div>
                  )}
                  <label
                    className={
                      "stow-field" +
                      (unresolvedItems.some(item => item.includes("密度"))
                        ? " stow-unresolved-field"
                        : "")
                    }
                  >
                    <span>密度 t/m³</span>
                    <input
                      type="number"
                      min="0"
                      step="0.001"
                      {...field("density")}
                      value={parcel.density}
                      onChange={event =>
                        patch(parcel.id, {
                          density: numberOrZero(event.target.value),
                        })
                      }
                    />
                  </label>

                  {intakeMode === "priority" && (
                    <label className="stow-field">
                      <span>优先级</span>
                      <input
                        type="number"
                        min="1"
                        step="1"
                        {...field("priority")}
                        value={parcel.intake?.priority ?? 1}
                        onChange={event =>
                          patch(parcel.id, {
                            intake: {
                              ...parcel.intake,
                              mode: "priority",
                              priority: numberOrZero(event.target.value),
                            },
                          })
                        }
                      />
                    </label>
                  )}
                  {intakeMode === "ratio" && (
                    <label className="stow-field">
                      <span>比例</span>
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        {...field("ratio")}
                        value={parcel.intake?.ratio ?? 1}
                        onChange={event =>
                          patch(parcel.id, {
                            intake: {
                              ...parcel.intake,
                              mode: "ratio",
                              ratio: numberOrZero(event.target.value),
                            },
                          })
                        }
                      />
                    </label>
                  )}
                  {intakeMode === "range" && (
                    <>
                      <label className="stow-field">
                        <span>最小量 MT</span>
                        <input
                          type="number"
                          min="0"
                          {...field("minMt")}
                          value={parcel.intake?.minMt ?? 0}
                          onChange={event =>
                            patch(parcel.id, {
                              intake: {
                                ...parcel.intake,
                                mode: "range",
                                minMt: numberOrZero(event.target.value),
                              },
                            })
                          }
                        />
                      </label>
                      <label className="stow-field">
                        <span>最大量 MT</span>
                        <input
                          type="number"
                          min="0"
                          {...field("maxMt")}
                          value={parcel.intake?.maxMt ?? 0}
                          onChange={event =>
                            patch(parcel.id, {
                              intake: {
                                ...parcel.intake,
                                mode: "range",
                                maxMt: numberOrZero(event.target.value),
                              },
                            })
                          }
                        />
                      </label>
                    </>
                  )}

                  <label className="stow-field">
                    <span>装货温度 ℃</span>
                    <input
                      type="number"
                      {...field("loadTempC")}
                      value={parcel.loadTempC ?? ""}
                      onChange={event => {
                        const value = optionalNumber(event.target.value);
                        patch(parcel.id, {
                          loadTempC: value == null ? undefined : value,
                        });
                      }}
                      placeholder="可空"
                    />
                  </label>
                  <label className="stow-field">
                    <span>沸点 ℃</span>
                    <input
                      type="number"
                      value={parcel.boilPointC ?? ""}
                      onChange={event =>
                        patch(parcel.id, {
                          boilPointC: optionalNumber(event.target.value),
                        })
                      }
                      placeholder="未知"
                    />
                  </label>
                  <label className="stow-field">
                    <span>凝点 ℃</span>
                    <input
                      type="number"
                      value={parcel.meltPointC ?? ""}
                      onChange={event =>
                        patch(parcel.id, {
                          meltPointC: optionalNumber(event.target.value),
                        })
                      }
                      placeholder="未知"
                    />
                  </label>
                  <label className="stow-field">
                    <span>最高允许温度 ℃</span>
                    <input
                      type="number"
                      value={parcel.maxAllowedTempC ?? ""}
                      onChange={event =>
                        patch(parcel.id, {
                          maxAllowedTempC: optionalNumber(event.target.value),
                        })
                      }
                      placeholder="可空"
                    />
                  </label>
                  <label className="stow-check stow-parcel-check">
                    <input
                      type="checkbox"
                      checked={parcel.heating.enabled}
                      onChange={event =>
                        patch(parcel.id, {
                          heating: event.target.checked
                            ? { enabled: true, carriageTempC: 0 }
                            : { enabled: false },
                        })
                      }
                    />
                    <span>需要加温</span>
                  </label>
                  {parcel.heating.enabled && (
                    <label className="stow-field">
                      <span>航行温度 ℃</span>
                      <input
                        type="number"
                        {...field("carriageTempC")}
                        value={parcel.heating.carriageTempC}
                        onChange={event =>
                          patch(parcel.id, {
                            heating: {
                              enabled: true,
                              carriageTempC: numberOrZero(event.target.value),
                            },
                          })
                        }
                      />
                    </label>
                  )}
                  <label className="stow-check stow-parcel-check">
                    <input
                      type="checkbox"
                      checked={parcel.polymerizable}
                      onChange={event =>
                        patch(parcel.id, { polymerizable: event.target.checked })
                      }
                    />
                    <span>可聚合</span>
                  </label>

                  <div className="stow-parcel-expand-actions">
                    <button
                      type="button"
                      className="stow-icon-button stow-icon-danger"
                      onClick={() => removeParcel(parcel.id)}
                      aria-label={`删除票货 ${index + 1}`}
                      title="删除"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {manual && parcel.group == null && (
                    <p className="stow-inline-warning">
                      族未知视为与所有货不相容
                    </p>
                  )}
                  {hasUnresolved && (
                    <p className="stow-inline-warning">
                      {unresolvedItems.join(" · ")}
                    </p>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>

      <div className="stow-parcel-footer">
        <MButton
          type="button"
          variant="soft"
          size="sm"
          icon={Plus}
          onClick={addParcel}
        >
          添加票货
        </MButton>
      </div>
    </MCard>
  );
}
