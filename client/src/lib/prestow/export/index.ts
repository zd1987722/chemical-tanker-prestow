import type { StowPlan, StowShip, StowVoyage } from "../types";
import { genericCsvExporter } from "./generic-csv";
export interface ExportFile { filename: string; content: string; mime: string }
export interface PlanExporter { id: string; label: string; ext: string; render(plan: StowPlan, rank: number, ship: StowShip, voyage: StowVoyage): ExportFile }
export const EXPORTERS: PlanExporter[] = [genericCsvExporter];
export { renderSummaryCsv } from "./summary-csv";
