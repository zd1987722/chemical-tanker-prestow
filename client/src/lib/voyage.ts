/**
 * 航次舱图相容性 —— 纯前端逻辑。
 * 邻接推导移植自 in-transit-cargo `backend/app/core/adjacency.py`(8 向 + cofferdam),
 * 相容判定用本地 USCG 矩阵 `uscg-compatibility-data`。
 */
import { USCG_GROUPS } from "./uscg-compatibility-data";
import { evaluateCompat, type PairException } from "./uscg-verdict";

export type Pos = "P" | "C" | "S";
export type Verdict = "compatible" | "reactive" | "unknown";

export interface VoyageCargo {
  id: string;
  name: string; // 相容匹配用(产品名)
  display?: string; // 显示名:中英文 IBC 名,缺失时回退 name
  group: number | null; // USCG 反应族编号
  tanks: string[];
}
export interface Voyage {
  vessel: string;
  voyageNo: string;
  ports: string;
  date: string;
  tanks: string[]; // 完整骨架(含空舱)
  cargoes: VoyageCargo[];
  cofferdams: string[][];
}
export interface AdjPair {
  a: string;
  b: string;
  cargoA: string;
  cargoB: string;
  groupA: number | null;
  groupB: number | null;
  verdict: Verdict;
  exception: PairException; // Appendix I 例外覆盖标记
  reason: string;
}
export interface Blocker {
  code: string;
  message: string;
  detail?: string;
  kind: "cargo" | "adjacency";
  pair?: [string, string];
  cargoId?: string;
}
export interface Review {
  adjacentPairs: AdjPair[];
  blockers: Blocker[];
}

const ATHWART: Record<string, number> = { P: 0, C: 1, S: 2 };

export function parseTank(id: string): { n: number; pos: Pos } | null {
  const m = /^(\d+)([PSC])$/.exec(id);
  if (m) return { n: parseInt(m[1], 10), pos: m[2] as Pos };
  // 通舱(全宽单舱,裸编号如「4」):相邻判定上等价于中央舱 ——
  // 中央舱与上下站的 P/C/S 全部相邻(athwart 距离 ≤1),正好对应全宽接触。
  const f = /^(\d+)$/.exec(id);
  return f ? { n: parseInt(f[1], 10), pos: "C" } : null;
}

export function groupName(g: number | null | undefined): string {
  if (g == null) return "未指定";
  return USCG_GROUPS[g] || `Group ${g}`;
}

/** 由舱位骨架推导相邻对(8 向;cofferdam 切断整道站间边界)。 */
export function deriveAdjacency(
  tanks: string[],
  cofferdams: string[][] = []
): [string, string][] {
  const excludedExact = new Set<string>();
  const blockedBoundaries = new Set<number>();
  for (const pair of cofferdams) {
    if (!pair || pair.length < 2) continue;
    const sorted = [pair[0], pair[1]].sort();
    excludedExact.add(sorted.join("|"));
    const pa = parseTank(pair[0]);
    const pb = parseTank(pair[1]);
    if (pa && pb && Math.abs(pa.n - pb.n) === 1)
      blockedBoundaries.add(Math.min(pa.n, pb.n));
  }

  const parsed: { n: number; pos: Pos; id: string }[] = [];
  const hasCenter = new Set<number>();
  for (const t of tanks) {
    const pt = parseTank(t);
    if (!pt) continue;
    parsed.push({ ...pt, id: t });
    if (pt.pos === "C") hasCenter.add(pt.n);
  }

  const pairs = new Set<string>();
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const a = parsed[i];
      const b = parsed[j];
      if (Math.abs(a.n - b.n) > 1) continue;
      // 横向是否相邻
      let ok: boolean;
      if (a.pos === b.pos) ok = true;
      else {
        const da = Math.abs(ATHWART[a.pos] - ATHWART[b.pos]);
        if (da === 1)
          ok = true; // P-C / C-S
        else ok = !hasCenter.has(a.n) && !hasCenter.has(b.n); // P-S 仅当无中央舱
      }
      if (!ok) continue;
      if (
        Math.abs(a.n - b.n) === 1 &&
        blockedBoundaries.has(Math.min(a.n, b.n))
      )
        continue;
      const key = [a.id, b.id].sort().join("|");
      if (!excludedExact.has(key)) pairs.add(key);
    }
  }
  return Array.from(pairs)
    .sort()
    .map(k => k.split("|") as [string, string]);
}

/** tankId -> { cargo, group } */
export function tankToGroup(
  cargoes: VoyageCargo[]
): Record<string, { cargo: VoyageCargo; group: number | null }> {
  const map: Record<string, { cargo: VoyageCargo; group: number | null }> = {};
  for (const c of cargoes) {
    for (const t of c.tanks) map[t] = { cargo: c, group: c.group };
  }
  return map;
}

export function computeReview(voyage: Voyage): Review {
  const t2g = tankToGroup(voyage.cargoes);
  const adjacentPairs: AdjPair[] = [];

  for (const [a, b] of deriveAdjacency(voyage.tanks, voyage.cofferdams)) {
    const ia = t2g[a];
    const ib = t2g[b];
    if (!ia || !ib) continue; // 至少一舱为空
    if (ia.cargo.id === ib.cargo.id) continue; // 同一货物跨舱
    const ev = evaluateCompat(ia.group, ib.group, ia.cargo.name, ib.cargo.name);
    const verdict: Verdict = !ev.known
      ? "unknown"
      : ev.isCompatible
        ? "compatible"
        : "reactive";
    const excNote =
      ev.exception === "prohibited"
        ? "(Appendix I 禁止例外覆盖)"
        : ev.exception === "allowed"
          ? "(Appendix I 允许例外覆盖)"
          : "";
    adjacentPairs.push({
      a,
      b,
      cargoA: ia.cargo.display || ia.cargo.name,
      cargoB: ib.cargo.display || ib.cargo.name,
      groupA: ia.group,
      groupB: ib.group,
      verdict,
      exception: ev.exception,
      reason:
        verdict === "reactive"
          ? `${groupName(ia.group)} 与 ${groupName(ib.group)} 相邻会发生危险反应,须隔离${excNote}`
          : verdict === "unknown"
            ? "存在未指定 USCG 分组的货物,无法判定相容性"
            : `分组相容,可相邻装载${excNote}`,
    });
  }

  const blockers: Blocker[] = [];
  for (const c of voyage.cargoes) {
    if (c.group == null || c.group < 1)
      blockers.push({
        code: "NO_GROUP",
        message:
          c.group == null
            ? `货物「${c.display || c.name}」未指定 USCG 反应族,无法判定相容性`
            : `货物「${c.display || c.name}」未归入标准 USCG 反应族(group 0 / 未归类),须个别评估`,
        cargoId: c.id,
        kind: "cargo",
      });
  }
  for (const p of adjacentPairs.filter(p => p.verdict === "reactive")) {
    blockers.push({
      code: "REACTIVE_ADJ",
      message: `相邻货舱 ${p.a} / ${p.b} 装载不相容货物`,
      detail: `${p.a} ${p.cargoA}(G${p.groupA}) ↔ ${p.b} ${p.cargoB}(G${p.groupB})`,
      pair: [p.a, p.b],
      kind: "adjacency",
    });
  }

  return { adjacentPairs, blockers };
}

/** 相邻组合的分组对(去重,"min-max")—— 供矩阵高亮。 */
export function adjacencyGroupPairs(
  review: Review
): { key: string; a: number; b: number; verdict: Verdict }[] {
  const seen = new Map<
    string,
    { key: string; a: number; b: number; verdict: Verdict }
  >();
  for (const p of review.adjacentPairs) {
    if (p.groupA == null || p.groupB == null) continue;
    const a = Math.min(p.groupA, p.groupB);
    const b = Math.max(p.groupA, p.groupB);
    const key = `${a}-${b}`;
    const prev = seen.get(key);
    // 同一格若既有 reactive 又有 compatible,取 reactive(更严重)
    if (!prev || (p.verdict === "reactive" && prev.verdict !== "reactive")) {
      seen.set(key, { key, a, b, verdict: p.verdict });
    }
  }
  return Array.from(seen.values());
}

export type BarrierType = "cofferdam" | "empty" | "cargo" | "distance";
export interface Barrier {
  type: BarrierType;
  /** cofferdam:被切断的舱对,如 ["5P","6P"];empty/cargo:中间舱号 */
  between?: [string, string];
  tank?: string;
  /** type === "cargo" 时:该舱所装货物的 display || name */
  cargoName?: string;
}
export interface CargoPairInfo {
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  aDisplay: string;
  bDisplay: string;
  aGroup: number | null;
  bGroup: number | null;
  verdict: Verdict;
  exception: PairException;
  adjacent: boolean;
  barriers: Barrier[];
}

/** 枚举本航次全部不同货物对,并说明非相邻货物间的实际隔离方式。 */
export function analyzeCargoPairs(voyage: Voyage): CargoPairInfo[] {
  const cargoes = voyage.cargoes.filter(c => c.tanks.length > 0);
  const edgeKey = (a: string, b: string) => [a, b].sort().join("|");
  const adjAll = new Set(
    deriveAdjacency(voyage.tanks, []).map(([a, b]) => edgeKey(a, b))
  );
  const adjCutPairs = deriveAdjacency(voyage.tanks, voyage.cofferdams);
  const adjCut = new Set(adjCutPairs.map(([a, b]) => edgeKey(a, b)));
  const neighbors = new Map<string, Set<string>>();
  for (const [a, b] of adjCutPairs) {
    if (!neighbors.has(a)) neighbors.set(a, new Set());
    if (!neighbors.has(b)) neighbors.set(b, new Set());
    neighbors.get(a)!.add(b);
    neighbors.get(b)!.add(a);
  }
  const occupied = new Map<string, VoyageCargo>();
  for (const cargo of voyage.cargoes)
    for (const tank of cargo.tanks) occupied.set(tank, cargo);

  const result: CargoPairInfo[] = [];
  for (let i = 0; i < cargoes.length; i++) {
    for (let j = i + 1; j < cargoes.length; j++) {
      const a = cargoes[i];
      const b = cargoes[j];
      if (a.id === b.id) continue;

      const ev = evaluateCompat(a.group, b.group, a.name, b.name);
      const verdict: Verdict = !ev.known
        ? "unknown"
        : ev.isCompatible
          ? "compatible"
          : "reactive";
      const adjacent = a.tanks.some(ta =>
        b.tanks.some(tb => adjCut.has(edgeKey(ta, tb)))
      );
      const barriers: Barrier[] = [];

      if (!adjacent) {
        const seen = new Set<string>();
        const addBarrier = (barrier: Barrier) => {
          const key =
            barrier.type === "cofferdam"
              ? `${barrier.type}:${barrier.between?.join("|")}`
              : `${barrier.type}:${barrier.tank ?? ""}`;
          if (!seen.has(key)) {
            seen.add(key);
            barriers.push(barrier);
          }
        };

        for (const ta of a.tanks) {
          for (const tb of b.tanks) {
            const key = edgeKey(ta, tb);
            if (adjAll.has(key) && !adjCut.has(key)) {
              addBarrier({
                type: "cofferdam",
                between: [ta, tb].sort() as [string, string],
              });
            }

            const aNeighbors = neighbors.get(ta);
            const bNeighbors = neighbors.get(tb);
            if (!aNeighbors || !bNeighbors) continue;
            for (const tank of Array.from(aNeighbors)) {
              if (!bNeighbors.has(tank)) continue;
              const middleCargo = occupied.get(tank);
              if (middleCargo) {
                addBarrier({
                  type: "cargo",
                  tank,
                  cargoName: middleCargo.display || middleCargo.name,
                });
              } else {
                addBarrier({ type: "empty", tank });
              }
            }
          }
        }

        if (barriers.length === 0) barriers.push({ type: "distance" });
        const order: Record<BarrierType, number> = {
          cofferdam: 0,
          empty: 1,
          cargo: 2,
          distance: 3,
        };
        barriers.sort((x, y) => {
          const byType = order[x.type] - order[y.type];
          if (byType !== 0) return byType;
          const xKey = x.tank ?? x.between?.join("|") ?? "";
          const yKey = y.tank ?? y.between?.join("|") ?? "";
          return xKey.localeCompare(yKey);
        });
      }

      result.push({
        aId: a.id,
        bId: b.id,
        aName: a.name,
        bName: b.name,
        aDisplay: a.display || a.name,
        bDisplay: b.display || b.name,
        aGroup: a.group,
        bGroup: b.group,
        verdict,
        exception: ev.exception,
        adjacent,
        barriers,
      });
    }
  }
  return result;
}
