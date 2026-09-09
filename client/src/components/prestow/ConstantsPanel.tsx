import { SlidersHorizontal } from "lucide-react";
import { MCard } from "@/components/maritime";
import { DEFAULT_CONSTANTS } from "@/lib/prestow/engine";
import { validationAttrs } from "./validation";
import type { ValidationIssue, StowVoyage, VoyageConstants } from "@/lib/prestow/types";

const FIELDS: Array<{
  key: Exclude<keyof VoyageConstants, "departureDate">;
  label: string;
  step?: number;
}> = [
  { key: "bunkersMt", label: "首港燃油 ROB 吨", step: 10 },
  { key: "bunkersLcg", label: "燃油 LCG m", step: 0.1 },
  { key: "bunkersVcg", label: "燃油 VCG m", step: 0.1 },
  { key: "freshWaterMt", label: "首港淡水 ROB 吨", step: 10 },
  { key: "freshWaterLcg", label: "淡水 LCG m", step: 0.1 },
  { key: "freshWaterVcg", label: "淡水 VCG m", step: 0.1 },
  { key: "constantsMt", label: "常数 吨", step: 10 },
  { key: "constantsLcg", label: "常数 LCG m", step: 0.1 },
  { key: "constantsVcg", label: "常数 VCG m", step: 0.1 },
  { key: "trimTargetMin", label: "纵倾目标最小 m", step: 0.1 },
  { key: "trimTargetMax", label: "纵倾目标最大 m", step: 0.1 },
  { key: "ballastTrimTarget", label: "压载态纵倾目标 m", step: 0.1 },
  { key: "ballastTrimMax", label: "压载态纵倾上限 m", step: 0.1 },
];

const CONSUMPTION_FIELDS = [
  ["serviceSpeedKn", "航速 kn"],
  ["seaMarginPct", "Sea margin %"],
  ["meSeaLadenTpd", "主机满载 t/d"],
  ["meSeaBallastTpd", "主机压载 t/d"],
  ["aeSeaTpd", "辅机海上 t/d"],
  ["aePortTpd", "辅机港内 t/d"],
  ["cargoOpsLoadTpd", "装货附加 t/d"],
  ["cargoOpsDischargeTpd", "卸货附加 t/d"],
  ["heatingTpdPer1000t", "加温 t/d 每 1000 t"],
  ["fwConsumptionTpd", "淡水消耗 t/d"],
  ["fwGeneratorSeaTpd", "造水 t/d"],
  ["cargoRateTph", "货操速率 t/h"],
  ["portFixedHours", "港内固定 h"],
  ["bunkerReserveDays", "燃油余量天"],
  ["bunkerCapacityMt", "燃油舱容 t"],
  ["freshWaterCapacityMt", "淡水舱容 t"],
] as const;

export function ConstantsPanel({
  voyage,
  onChange,
  issues = [],
}: {
  voyage: StowVoyage;
  issues?: ValidationIssue[];
  onChange(update: StowVoyage | ((prev: StowVoyage) => StowVoyage)): void;
}) {
  const constants = { ...DEFAULT_CONSTANTS, ...voyage.constants };
  const patch = (key: keyof VoyageConstants, value: number | string | undefined) =>
    onChange(previous => ({
      ...previous,
      constants: {
        ...DEFAULT_CONSTANTS,
        ...previous.constants,
        [key]: value,
      },
    }));

  return (
    <MCard className="stow-section stow-collapsible-card" tabIndex={-1} {...validationAttrs(issues, { section: "constants" })}>
      <details>
        <summary>
          <span className="stow-summary-title">
            <SlidersHorizontal size={16} />
            航次常数
          </span>
          <small>燃油、淡水、常数与纵倾提示目标</small>
        </summary>
        <div className="stow-constants-grid">
          {FIELDS.map(field => (
            <label className="stow-field" key={field.key}>
              <span>{field.label}</span>
              <input
                type="number"
                step={field.step ?? 1}
                {...validationAttrs(issues, { section: "constants", field: field.key })}
                value={constants[field.key] ?? 0}
                onChange={event => patch(field.key, Number(event.target.value))}
              />
            </label>
          ))}
        </div>
        <h3 className="stow-constants-heading">航程消耗</h3>
        <div className="stow-constants-grid">
          <label className="stow-field"><span>出发日期</span>
            <input type="date" value={constants.departureDate ?? ""} onChange={event => patch("departureDate", event.target.value || undefined)} />
          </label>
          {CONSUMPTION_FIELDS.map(([key, label]) => (
            <label className="stow-field" key={key}><span>{label}</span>
              <input type="number" step="any" min={key === "serviceSpeedKn" || key === "cargoRateTph" ? 0.1 : 0}
                {...validationAttrs(issues, { section: "constants", field: key })}
                value={constants[key]} onChange={event => patch(key, event.target.value === "" ? DEFAULT_CONSTANTS[key] : Number(event.target.value))} />
            </label>
          ))}
        </div>
        <p className="stow-panel-note">纵倾目标用于自动配置压载；压载态同时校核吃水与螺旋桨浸没。</p>
      </details>
    </MCard>
  );
}
