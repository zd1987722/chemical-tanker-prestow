import type {
  Allocation,
  Parcel,
  PortCall,
  StowShip,
} from "@/lib/prestow/types";
import type { ParcelVisuals } from "./presentation";

function portLabel(call: PortCall | undefined, calls: PortCall[]): string {
  if (!call) return "未指定";
  const port = call.port || "未填港口";
  const repeated =
    calls.filter(item => (item.port || "未填港口") === port).length > 1;
  return repeated ? `${port} · ${call.berth || "未填泊位"}` : port;
}

function formatTonnes(value: number): string {
  return Math.round(value).toLocaleString("en-US").replace(/,/g, "\u202f");
}

export function ParcelLegend({
  parcels,
  allocations,
  visuals,
  calls,
  ship,
  intake,
}: {
  parcels: Parcel[];
  allocations: Allocation[];
  visuals: ParcelVisuals;
  calls: PortCall[];
  ship: StowShip;
  intake?: Record<string, number>;
}) {
  const allocationByParcel = new Map(
    allocations.map(allocation => [allocation.parcelId, allocation])
  );
  const callById = new Map(calls.map(call => [call.id, call]));
  const tankById = new Map(ship.tanks.map(tank => [tank.id, tank]));

  return (
    <div className="stow-legend">
      {parcels.map(parcel => {
        const allocation = allocationByParcel.get(parcel.id);
        const calculatedWeight = allocation
          ? allocation.tanks.reduce(
              (sum, tankId) =>
                sum +
                (tankById.get(tankId)?.cap100 ?? 0) *
                  allocation.fillRatio *
                  parcel.density,
              0
            )
          : 0;
        const weight = intake?.[parcel.id] ?? calculatedWeight;
        const fillPct = (allocation?.fillRatio ?? 0) * 100;

        return (
          <div className="stow-legend-row" key={parcel.id}>
            <span
              className="stow-legend-swatch"
              style={{ background: visuals[parcel.id].color }}
            >{visuals[parcel.id].label}</span>
            <span className="stow-legend-main">
              <strong>{parcel.display}</strong>
              <small>
                {portLabel(callById.get(parcel.loadCallId), calls)} →{" "}
                {portLabel(callById.get(parcel.dischargeCallId), calls)}
              </small>
            </span>
            <span className="stow-legend-value mono">
              <strong>{allocation?.tanks.join("、") || "未分配"}</strong>
              <small>
                {formatTonnes(weight)} t · {fillPct.toFixed(1)}%
              </small>
            </span>
          </div>
        );
      })}
    </div>
  );
}
