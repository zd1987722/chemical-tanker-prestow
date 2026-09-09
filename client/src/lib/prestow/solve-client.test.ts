import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_STOW_SHIP } from "./demo-ship";
import { SAMPLE_VOYAGES } from "./sample-voyages";
import { createSolver, SolverCancelled, type SolverRequest, type SolverResponse } from "./solve-client";
import type { StowPlan } from "./types";

class WorkerStub {
  static instances: WorkerStub[] = [];
  onmessage?: (event: { data: SolverResponse }) => void;
  onerror?: () => void;
  requests: SolverRequest[] = [];
  terminate = vi.fn();
  constructor() { WorkerStub.instances.push(this); }
  postMessage(request: SolverRequest) { this.requests.push(request); }
  reply(response: SolverResponse) { this.onmessage?.({ data: response }); }
}

const voyage = SAMPLE_VOYAGES[0].voyage;
// 协议测试仅透传方案，不运行船舶计算。
const plan = { key: "first", stages: [] } as unknown as StowPlan;

describe("后台精算请求", () => {
  beforeEach(() => { WorkerStub.instances = []; vi.stubGlobal("Worker", WorkerStub); });
  afterEach(() => vi.unstubAllGlobals());

  it("预热创建工作线程并发送探测消息", () => {
    const solver = createSolver();
    solver.warm();
    expect(WorkerStub.instances).toHaveLength(1);
    expect(WorkerStub.instances[0].requests).toEqual([{ id: 0, type: "ping" }]);
    solver.dispose();
    expect(WorkerStub.instances[0].terminate).toHaveBeenCalledOnce();
  });

  it("没有进行中请求时取消保留预热的工作线程", async () => {
    const solver = createSolver();
    solver.warm();
    const worker = WorkerStub.instances[0];
    solver.cancel();
    expect(worker.terminate).not.toHaveBeenCalled();
    const result = solver.solve(voyage);
    expect(WorkerStub.instances).toEqual([worker]);
    worker.reply({ id: worker.requests[1].id, type: "solve", result: { status: "invalid", errors: [] } });
    await expect(result).resolves.toEqual({ status: "invalid", errors: [] });
    solver.cancel();
    expect(worker.terminate).not.toHaveBeenCalled();
    solver.dispose();
  });

  it("探测回复和未知编号不会完成或移除进行中的请求", async () => {
    const solver = createSolver();
    solver.warm();
    const result = solver.solve(voyage);
    const completed = vi.fn();
    void result.then(completed);
    const worker = WorkerStub.instances[0];
    const id = worker.requests[1].id;
    worker.reply({ id: 0, type: "pong" });
    worker.reply({ id, type: "pong" });
    worker.reply({ id: id + 1, type: "solve", result: { status: "invalid", errors: [] } });
    await Promise.resolve();
    expect(completed).not.toHaveBeenCalled();
    worker.reply({ id, type: "solve", result: { status: "invalid", errors: [] } });
    await expect(result).resolves.toEqual({ status: "invalid", errors: [] });
    solver.dispose();
  });

  it("同步回退模式下预热不发送消息", () => {
    vi.stubGlobal("Worker", undefined);
    const solver = createSolver();
    solver.warm();
    expect(solver.mode).toBe("sync");
    solver.warm();
    expect(WorkerStub.instances).toHaveLength(0);
    solver.dispose();
  });

  it("切换方案取消旧请求，迟到结果不会完成新请求", async () => {
    const solver = createSolver();
    const first = solver.precise(DEMO_STOW_SHIP, voyage, plan).catch(error => error);
    const oldWorker = WorkerStub.instances[0];
    solver.cancel();
    expect(await first).toBeInstanceOf(SolverCancelled);
    expect(oldWorker.terminate).toHaveBeenCalledOnce();

    const second = solver.precise(DEMO_STOW_SHIP, voyage, { ...plan, key: "second" });
    const newWorker = WorkerStub.instances[1];
    const completed = vi.fn();
    void second.then(completed);
    oldWorker.reply({ id: oldWorker.requests[0].id, type: "precise", stages: {} });
    await Promise.resolve();
    expect(completed).not.toHaveBeenCalled();
    expect(newWorker.requests[0]).toMatchObject({ type: "precise", ship: DEMO_STOW_SHIP, plan: { key: "second" } });
    newWorker.reply({ id: newWorker.requests[0].id, type: "precise", stages: {} });
    await expect(second).resolves.toEqual({});
    solver.dispose();
  });

  it("Worker 不可用时明确报错，不在主线程重跑精算", async () => {
    vi.stubGlobal("Worker", undefined);
    const solver = createSolver();
    await expect(solver.precise(DEMO_STOW_SHIP, voyage, plan)).rejects.toThrow("后台精算不可用");
    solver.dispose();
  });

  it("Worker 加载失败后停止请求并保留可解释的错误", async () => {
    const solver = createSolver();
    const result = solver.precise(DEMO_STOW_SHIP, voyage, plan);
    const assertion = expect(result).rejects.toThrow("后台精算不可用");
    WorkerStub.instances[0].onerror?.();
    await assertion;
    expect(WorkerStub.instances[0].terminate).toHaveBeenCalledOnce();
    solver.dispose();
  });
});
