import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import { MButton, MCard, SectionTitle } from "@/components/maritime";
import { validationAttrs } from "./validation";
import type { ValidationIssue, PortCall, StowVoyage } from "@/lib/prestow/types";

function makeId(): string {
  return (
    globalThis.crypto?.randomUUID?.() ??
    Date.now().toString(36) + Math.random().toString(36).slice(2)
  );
}

function resequence(calls: PortCall[]): PortCall[] {
  return calls.map((call, index) => ({ ...call, seq: index }));
}

export function VoyageForm({
  voyage,
  onChange,
  unresolved = [],
  issues = [],
}: {
  voyage: StowVoyage;
  onChange(update: StowVoyage | ((prev: StowVoyage) => StowVoyage)): void;
  unresolved?: string[];
  issues?: ValidationIssue[];
}) {
  const [expandedNotes, setExpandedNotes] = useState<Set<string>>(
    () => new Set()
  );
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const calls = [...voyage.calls].sort((a, b) => a.seq - b.seq);

  useEffect(() => {
    if (openMenuId == null) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest("[data-stow-call-menu]")) {
        setOpenMenuId(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenuId(null);
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openMenuId]);

  const setCalls = (update: (calls: PortCall[]) => PortCall[]) =>
    onChange(prev => ({
      ...prev,
      calls: resequence(update([...prev.calls].sort((a, b) => a.seq - b.seq))),
    }));

  const patchCall = (id: string, patch: Partial<PortCall>) =>
    setCalls(items =>
      items.map(call => (call.id === id ? { ...call, ...patch } : call))
    );

  const moveCall = (index: number, offset: -1 | 1) => {
    setCalls(items => {
      const target = index + offset;
      if (target < 0 || target >= items.length) return items;
      const next = [...items];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const toggleNote = (id: string) => {
    setExpandedNotes(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <MCard className="stow-section" tabIndex={-1} {...validationAttrs(issues, { section: "calls" })}>
      <SectionTitle sub="船舶固定为当前样船，停靠点顺序用于装卸阶段推演。">
        航次与停靠点
      </SectionTitle>

      <label className="stow-field stow-voyage-no">
        <span>航次号</span>
        <input
          value={voyage.voyageNo}
          onChange={event =>
            onChange(prev => ({ ...prev, voyageNo: event.target.value }))
          }
          placeholder="例如 2026-007"
        />
      </label>

      <div className="stow-call-list">
        <div className="stow-call-row stow-call-row-head" aria-hidden="true">
          <span />
          <span>港口</span>
          <span>泊位</span>
          <span>最大吃水</span>
          <span>水密度</span>
          <span />
        </div>
        {calls.map((call, index) => {
          const field = (name?: string) => validationAttrs(issues, { section: "calls", index: voyage.calls.indexOf(call), field: name });
          const references = voyage.parcels.filter(
            parcel =>
              parcel.loadCallId === call.id ||
              parcel.dischargeCallId === call.id
          ).length;
          const unresolvedItems = unresolved.filter(
            item =>
              (call.port !== "" && item.includes(call.port)) ||
              (call.berth !== "" && item.includes(call.berth))
          );
          const hasUnresolved = unresolvedItems.length > 0;
          const density = call.waterDensity ?? 1.025;
          const densityPreset = [1.025, 1.015, 1].some(
            value => Math.abs(value - density) < 0.000_001
          );
          const noteExpanded = expandedNotes.has(call.id);
          const menuOpen = openMenuId === call.id;

          return (
            <div
              className={
                "stow-call-item" +
                (hasUnresolved ? " stow-unresolved-block" : "") +
                (menuOpen ? " stow-call-menu-open" : "")
              }
              key={call.id}
              tabIndex={-1}
              {...field()}
            >
              <div className="stow-call-row">
                <span className="stow-call-seq">{call.seq + 1}</span>
                <label className="stow-call-field"><span>港口</span>
                <input
                  aria-label={`停靠点 ${call.seq + 1} 港口`}
                  value={call.port}
                  onChange={event =>
                    patchCall(call.id, { port: event.target.value })
                  }
                  placeholder="港口"
                />
                </label>
                <label className="stow-call-field"><span>泊位</span>
                <input
                  aria-label={`停靠点 ${call.seq + 1} 泊位`}
                  value={call.berth}
                  onChange={event =>
                    patchCall(call.id, { berth: event.target.value })
                  }
                  placeholder="泊位"
                />
                </label>
                <label className="stow-call-field"><span>最大吃水 m</span>
                <input
                  {...field("maxDraftM")}
                  aria-label={`停靠点 ${call.seq + 1} 最大吃水（m）`}
                  type="number"
                  min="0"
                  step="0.1"
                  value={call.maxDraftM ?? ""}
                  onChange={event => {
                    const value = event.target.value;
                    patchCall(call.id, {
                      maxDraftM: value === "" ? undefined : Number(value),
                    });
                  }}
                  placeholder="不限"
                />
                </label>
                <label className="stow-call-field"><span>水密度</span>
                <select
                  {...(densityPreset ? field("waterDensity") : {})}
                  aria-label={`停靠点 ${call.seq + 1} 水密度`}
                  value={densityPreset ? density.toFixed(3) : "custom"}
                  onChange={event =>
                    patchCall(call.id, {
                      waterDensity:
                        event.target.value === "custom"
                          ? 1.02
                          : Number(event.target.value),
                    })
                  }
                >
                  <option value="1.025">海水 1.025</option>
                  <option value="1.015">咸淡水 1.015</option>
                  <option value="1.000">淡水 1.000</option>
                  <option value="custom">自填</option>
                </select>
                </label>
                <div className="stow-call-actions" data-stow-call-menu>
                  <button
                    type="button"
                    className="stow-icon-button"
                    onClick={() =>
                      setOpenMenuId(previous =>
                        previous === call.id ? null : call.id
                      )
                    }
                    aria-expanded={menuOpen}
                    aria-haspopup="menu"
                    aria-label={`停靠点 ${call.seq + 1} 操作`}
                    title="更多操作"
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </div>
              </div>

              {menuOpen && (
                <div
                  className="stow-call-menu"
                  data-stow-call-menu
                  role="menu"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      moveCall(index, -1);
                      setOpenMenuId(null);
                    }}
                    disabled={index === 0}
                  >
                    <ArrowUp size={14} />
                    <span>上移</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      moveCall(index, 1);
                      setOpenMenuId(null);
                    }}
                    disabled={index === calls.length - 1}
                  >
                    <ArrowDown size={14} />
                    <span>下移</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className={call.note ? "stow-call-note-active" : undefined}
                    onClick={() => {
                      toggleNote(call.id);
                      setOpenMenuId(null);
                    }}
                  >
                    <MessageSquare size={14} />
                    <span>备注</span>
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    className="stow-icon-danger"
                    onClick={() => {
                      setCalls(items =>
                        items.filter(item => item.id !== call.id)
                      );
                      setOpenMenuId(null);
                    }}
                    disabled={references > 0}
                    title={
                      references > 0
                        ? `有 ${references} 票货引用，请先修改票货`
                        : "删除"
                    }
                  >
                    <Trash2 size={14} />
                    <span>删除</span>
                    {references > 0 && (
                      <small>{references} 票货引用，请先修改票货</small>
                    )}
                  </button>
                </div>
              )}

              <details className="stow-call-leg">
                <summary>航段</summary>
                <div className="stow-constants-grid">
                  {([
                    ["distanceNm", "距上港 nm"], ["speedKn", "航速 kn(可空)"],
                    ["portHours", "港时 h(可空)"], ["bunkerMt", "加油 t"],
                    ["freshWaterTakeMt", "加水 t"],
                  ] as const).map(([key, label]) => (
                    <label className="stow-field" key={key}>
                      <span>{label}</span>
                      <input type="number" min={key === "speedKn" ? 0.1 : 0} step="any"
                        disabled={key === "distanceNm" && index === 0}
                        {...field(key)}
                        value={call[key] ?? ""}
                        onChange={event => patchCall(call.id, { [key]: event.target.value === "" ? undefined : Number(event.target.value) })} />
                    </label>
                  ))}
                  <label className="stow-field">
                    <span>载重线区</span>
                    <select {...field("loadLineZone")} value={call.loadLineZone ?? "summer"} onChange={event => patchCall(call.id, { loadLineZone: event.target.value as PortCall["loadLineZone"] })}>
                      <option value="summer">夏</option><option value="winter">冬</option><option value="tropical">热带</option>
                    </select>
                  </label>
                </div>
              </details>

              {noteExpanded && (
                <div className="stow-call-note">
                  <input
                    aria-label={`停靠点 ${call.seq + 1} 备注`}
                    value={call.note ?? ""}
                    onChange={event =>
                      patchCall(call.id, { note: event.target.value })
                    }
                    placeholder="添加备注（可选）"
                  />
                </div>
              )}

              {!densityPreset && (
                <label className="stow-call-custom-density">
                  <span>自填水密度</span>
                  <input
                    type="number"
                    min="0.9"
                    max="1.1"
                    step="0.001"
                    {...field("waterDensity")}
                    value={density}
                    onChange={event =>
                      patchCall(call.id, {
                        waterDensity: Number(event.target.value),
                      })
                    }
                  />
                </label>
              )}

              {hasUnresolved && (
                <p className="stow-call-warning">{unresolvedItems.join(" · ")}</p>
              )}
            </div>
          );
        })}
      </div>

      <MButton
        type="button"
        variant="soft"
        size="sm"
        icon={Plus}
        onClick={() =>
          setCalls(items => [
            ...items,
            { id: makeId(), seq: items.length, port: "", berth: "" },
          ])
        }
      >
        添加停靠点
      </MButton>
    </MCard>
  );
}
