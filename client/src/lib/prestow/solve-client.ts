/**
 * 主线程侧的求解入口:优先用 Web Worker(不冻结界面、可取消),Worker 不可用时退回同步求解。
 */
import { getRuntimeExceptions, type AllowedException, type ProhibitedException } from "../appendix-i-exceptions";
import { DEMO_STOW_SHIP } from "./demo-ship";
import { solvePrestow } from "./engine";
import { proposeRepairs } from "./repair";
import type { precisePlanStages } from "./precise";
import type { Diagnosis, RepairReport, StowPlan, StowResult, StowShip, StowVoyage } from "./types";

export type PreciseStages = ReturnType<typeof precisePlanStages>;

export interface SolverExceptions { allowed: AllowedException[]; prohibited: ProhibitedException[] }
export type SolverRequest =
  | { id: number; type: "ping" }
  | { id: number; type: "solve"; voyage: StowVoyage; exceptions: SolverExceptions }
  | { id: number; type: "precise"; ship: StowShip; voyage: StowVoyage; plan: StowPlan; exceptions: SolverExceptions }
  | { id: number; type: "repair"; voyage: StowVoyage; diagnosis?: Diagnosis; exceptions: SolverExceptions };
export type SolverResponse =
  | { id: number; type: "pong" }
  | { id: number; type: "solve"; result: StowResult }
  | { id: number; type: "precise"; stages: PreciseStages }
  | { id: number; type: "repair"; report: RepairReport }
  | { id: number; type: "error"; message: string };

export interface Solver {
  warm(): void;
  solve(voyage: StowVoyage): Promise<StowResult>;
  precise(ship: StowShip, voyage: StowVoyage, plan: StowPlan): Promise<PreciseStages>;
  repair(voyage: StowVoyage, diagnosis?: Diagnosis): Promise<RepairReport>;
  /** 取消所有进行中的请求(终止 worker,下次请求自动重建)。 */
  cancel(): void;
  dispose(): void;
  readonly mode: "worker" | "sync";
}

type Pending = { resolve: (value: SolverResponse) => void; reject: (reason: Error) => void };

export class SolverCancelled extends Error {
  constructor() { super("已取消"); this.name = "SolverCancelled"; }
}

function createWorker(): Worker | null {
  try {
    if (typeof Worker === "undefined") return null;
    return new Worker(new URL("./solve.worker.ts", import.meta.url), { type: "module" });
  } catch {
    return null;
  }
}

export function createSolver(): Solver {
  let worker: Worker | null = null;
  let workerBroken = false;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  const ensureWorker = (): Worker | null => {
    if (workerBroken) return null;
    if (worker) return worker;
    worker = createWorker();
    if (!worker) { workerBroken = true; return null; }
    worker.onmessage = (event: MessageEvent<SolverResponse>) => {
      if (event.data.type === "pong") return;
      const entry = pending.get(event.data.id);
      if (!entry) return;
      pending.delete(event.data.id);
      entry.resolve(event.data);
    };
    worker.onerror = () => {
      // Worker 本身失败(加载 / 运行时错误):让所有等待方退回同步路径
      workerBroken = true;
      const entries = Array.from(pending.values());
      pending.clear();
      worker?.terminate();
      worker = null;
      for (const entry of entries) entry.reject(new Error("worker-failed"));
    };
    return worker;
  };

  const send = (request: SolverRequest): Promise<SolverResponse> => new Promise((resolve, reject) => {
    const w = ensureWorker();
    if (!w) { reject(new Error("worker-unavailable")); return; }
    pending.set(request.id, { resolve, reject });
    w.postMessage(request);
  });

  const exceptions = (): SolverExceptions => {
    const current = getRuntimeExceptions();
    return { allowed: current.allowed, prohibited: current.prohibited };
  };

  const solveSync = (voyage: StowVoyage): StowResult => solvePrestow(DEMO_STOW_SHIP, voyage);
  const repairSync = (voyage: StowVoyage, diagnosis?: Diagnosis): RepairReport => proposeRepairs(DEMO_STOW_SHIP, voyage, diagnosis);

  const run = async <T>(request: SolverRequest, pick: (response: SolverResponse) => T | undefined, fallback: () => T): Promise<T> => {
    try {
      const response = await send(request);
      if (response.type === "error") throw new Error(response.message);
      const value = pick(response);
      if (value === undefined) throw new Error("unexpected-response");
      return value;
    } catch (error) {
      if (error instanceof SolverCancelled) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (message === "worker-unavailable" || message === "worker-failed") return fallback();
      throw error;
    }
  };

  return {
    get mode() { return workerBroken ? "sync" : "worker"; },
    warm() {
      ensureWorker()?.postMessage({ id: 0, type: "ping" });
    },
    solve: voyage => run(
      { id: nextId++, type: "solve", voyage, exceptions: exceptions() },
      response => response.type === "solve" ? response.result : undefined,
      () => solveSync(voyage),
    ),
    repair: (voyage, diagnosis) => run(
      { id: nextId++, type: "repair", voyage, diagnosis, exceptions: exceptions() },
      response => response.type === "repair" ? response.report : undefined,
      () => repairSync(voyage, diagnosis),
    ),
    precise: (ship, voyage, plan) => run(
      { id: nextId++, type: "precise", ship, voyage, plan, exceptions: exceptions() },
      response => response.type === "precise" ? response.stages : undefined,
      // 精算不可用时保留标明来源的估算，避免重新阻塞主线程。
      () => { throw new Error("后台精算不可用，请刷新后重试"); },
    ),
    cancel() {
      if (pending.size === 0) return;
      const entries = Array.from(pending.values());
      pending.clear();
      worker?.terminate();
      worker = null;
      for (const entry of entries) entry.reject(new SolverCancelled());
    },
    dispose() {
      this.cancel();
      worker?.terminate();
      worker = null;
    },
  };
}
