import { useEffect, useRef, useState } from "react";
import { createSolver, SolverCancelled, type PreciseStages, type Solver } from "@/lib/prestow/solve-client";
import type { StowPlan, StowShip, StowVoyage } from "@/lib/prestow/types";

type Result = { status: "pending" | "ready" | "error"; stages: PreciseStages; error?: string };

/** 同一航次缓存已查看的方案；切换后终止旧计算，旧结果不得回填。 */
export function usePrecisePlan(ship: StowShip, voyage: StowVoyage, plan: StowPlan | null): Result {
  const solver = useRef<Solver | null>(null);
  const cache = useRef({ ship, voyage, plans: new Map<StowPlan, PreciseStages>() });
  const [state, setState] = useState<{ ship: StowShip; voyage: StowVoyage; plan: StowPlan | null; result: Result } | null>(null);

  useEffect(() => {
    if (cache.current.ship !== ship || cache.current.voyage !== voyage) {
      cache.current = { ship, voyage, plans: new Map() };
    }
    if (!plan) return;
    const cached = cache.current.plans.get(plan);
    if (cached) {
      setState({ ship, voyage, plan, result: { status: "ready", stages: cached } });
      return;
    }
    const current = solver.current ??= createSolver();
    let active = true;
    setState({ ship, voyage, plan, result: { status: "pending", stages: {} } });
    current.precise(ship, voyage, plan).then(stages => {
      if (!active) return;
      if (cache.current.plans.size >= 8) cache.current.plans.delete(cache.current.plans.keys().next().value!);
      cache.current.plans.set(plan, stages);
      setState({ ship, voyage, plan, result: { status: "ready", stages } });
    }).catch(error => {
      if (!active || error instanceof SolverCancelled) return;
      setState({ ship, voyage, plan, result: { status: "error", stages: {}, error: error instanceof Error ? error.message : String(error) } });
    });
    return () => { active = false; current.cancel(); };
  }, [ship, voyage, plan]);

  useEffect(() => () => solver.current?.dispose(), []);
  return state?.ship === ship && state.voyage === voyage && state.plan === plan
    ? state.result
    : { status: "pending", stages: {} };
}
