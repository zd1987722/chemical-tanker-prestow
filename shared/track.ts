export const TRACK_EVENTS = [
  "page_view", "sample_load", "mail_import", "mail_import_error",
  "scenario_ai_parse", "scenario_apply", "solve", "plan_select",
  "stage_select", "precise_open", "export_csv", "send_to_loadcalc",
  "demo_mail_download", "loadcalc_condition", "loadcalc_tool", "loadcalc_report",
  "repair_apply",
] as const;

export type TrackEvent = (typeof TRACK_EVENTS)[number];

export interface ScenarioAiParseTrackProps { chars: number; trigger: "button" | "sample" | "mail"; }

export interface SolveTrackProps {
  calls: number; parcels: number; plans: number; rejected: number; ms: number;
  status: "invalid" | "ok" | "truncated";
  reason: string;
  error?: string;
}
