/**
 * 预配载求解 Web Worker:把枚举 / 意向求解 / 修改建议搬离主线程,页面不再冻结。
 * 消息协议见 solve-client.ts。Appendix I 例外随计算请求带入(worker 与主线程状态隔离)。
 */
import { setRuntimeExceptions } from "../appendix-i-exceptions";
import { DEMO_STOW_SHIP } from "./demo-ship";
import { solvePrestow } from "./engine";
import { proposeRepairs } from "./repair";
import { precisePlanStages } from "./precise";
import type { SolverRequest, SolverResponse } from "./solve-client";

self.onmessage = (event: MessageEvent<SolverRequest>) => {
  const request = event.data;
  const reply = (response: SolverResponse) => (self as unknown as Worker).postMessage(response);
  if (request.type === "ping") {
    reply({ id: request.id, type: "pong" });
    return;
  }
  try {
    setRuntimeExceptions(request.exceptions.allowed, request.exceptions.prohibited);
    if (request.type === "solve") {
      reply({ id: request.id, type: "solve", result: solvePrestow(DEMO_STOW_SHIP, request.voyage) });
    } else if (request.type === "precise") {
      reply({ id: request.id, type: "precise", stages: precisePlanStages(request.ship, request.voyage, request.plan) });
    } else {
      reply({ id: request.id, type: "repair", report: proposeRepairs(DEMO_STOW_SHIP, request.voyage, request.diagnosis) });
    }
  } catch (error) {
    reply({ id: request.id, type: "error", message: error instanceof Error ? error.message : String(error) });
  }
};
