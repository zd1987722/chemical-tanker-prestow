import { describe, expect, it } from "vitest";
import { formatNominationMail } from "./mail-format";
import { parseNominationMail } from "./mail-parse";
import { PRODUCT_CATALOG, resolveCatalogProduct } from "./product-catalog";
import { SAMPLE_VOYAGES, findSampleVoyage } from "./sample-voyages";
import type { Parcel } from "./types";

const equivalent = ({ id, intake, ...parcel }: Parcel) => ({ ...parcel, ...(intake && intake.mode !== "fixed" ? { intake } : {}) });
const mail = (cargo: string) => `航次号: TEST
装港顺序:
1. 蔚山 / 3 号泊位
卸港顺序:
2. 鹿特丹 / Botlek
货票:
${cargo}`;

describe("nomination mail", () => {
  it.each(SAMPLE_VOYAGES)("round trips $id without changing preset fields", ({ voyage }) => {
    const formatted = formatNominationMail(voyage);
    expect(formatted.body).not.toMatch(/(?<!\r)\n/);
    const parsed = parseNominationMail(formatted.body);
    expect(parsed.unresolved).toEqual([]);
    expect(parsed.voyage.voyageNo).toBe(voyage.voyageNo);
    expect(parsed.voyage.shipId).toBe("");
    if (voyage.constants) expect(parsed.voyage.constants).toEqual(voyage.constants);
    else expect(parsed.voyage).not.toHaveProperty("constants");
    expect(parsed.voyage.calls).toEqual(voyage.calls);
    expect(parsed.voyage.parcels.map(equivalent)).toEqual(voyage.parcels.map(equivalent));
  });
  it("formats the deduplicated subject in rotation order", () => {
    expect(formatNominationMail(findSampleVoyage("far-east-europe-12")!.voyage).subject)
      .toBe("配载申请 / DEMO-2026-05 / 蔚山-丽水-大山-宁波 → 安特卫普-鹿特丹-汉堡");
  });
  it("retains unknown products and flags unmatched discharge calls", () => {
    const parsed = parseNominationMail(mail("1. 未知溶液 · 100 MT · 密度 1.200 · 蔚山 3 号泊位 → 错误港"));
    expect(parsed.voyage.parcels[0]).toMatchObject({ name: "未知溶液", group: null, density: 1.2, dischargeCallId: "", boilPointC: null });
    expect(parsed.unresolved).toEqual(["未识别货品:未知溶液,请手工指定 USCG 族与密度", "卸港无法匹配停靠点:错误港(未知溶液)"]);
  });
  it("parses range and ratio and supports alternate separators, arrows and units", () => {
    const parsed = parseNominationMail(mail(`1. NaOH ; 4,000–8,000 mt(区间) ; 蔚山 3 号泊位 -> 鹿特丹 Botlek
2. MEG · ratio 2 · 蔚山 3 号泊位 至 鹿特丹 Botlek
3. 苯酚 · 1\u202f200 吨 · 加温 50 °C · 蔚山 3 号泊位 → 鹿特丹 Botlek · 密度 1.050
4. MeOH · 1 200 t · 蔚山 3 号泊位 → 鹿特丹 Botlek`));
    expect(parsed.unresolved).toEqual([]);
    expect(parsed.voyage.parcels.map(p => p.intake)).toEqual([{ mode: "range", minMt: 4000, maxMt: 8000 }, { mode: "ratio", ratio: 2 }, undefined, undefined]);
    expect(parsed.voyage.parcels[2]).toMatchObject({ quantityMt: 1200, heating: { enabled: true, carriageTempC: 50 } });
    expect(parsed.voyage.parcels[3].quantityMt).toBe(1200);
    const again = parseNominationMail(formatNominationMail(parsed.voyage).body);
    expect(again.voyage).toEqual(parsed.voyage);
  });
  it("ignores free text, subject and remarks while taking voyage anywhere", () => {
    expect(parseNominationMail("请安排甲醇装船").matched).toEqual({ calls: 0, parcels: 0 });
    const parsed = parseNominationMail("Subject: ignored\nOther calls：  \n1) 中转港 · 咸淡水\n2. 另一港 · SW\n3. 第三港 · FW\nRemarks:\nCargoes:\nignored\nVoyage: V2");
    expect(parsed.unresolved).toEqual([]);
    expect(parsed.voyage.voyageNo).toBe("V2");
    expect(parsed.voyage.calls.map(c => [c.id, c.berth, c.waterDensity])).toEqual([["C1", "", 1.015], ["C2", "", 1.025], ["C3", "", 1]]);
    expect(formatNominationMail(parsed.voyage).body).toContain("其他停靠:\r\n1. 中转港 · 咸淡水 1.015");
  });
  it("uses longest berth match, then unknown calls, and deduplicates unresolved lines", () => {
    const parsed = parseNominationMail(`Load ports:
1. A / B
2. A / B2
Other calls:
3. C
Cargoes:
1. methanol · max · A B2 → C
2. methanol · 尽量多 · A B → C
invalid
invalid`);
    expect(parsed.voyage.parcels.map(p => [p.loadCallId, p.dischargeCallId, p.intake?.priority])).toEqual([["L2", "C1", 1], ["L1", "C1", 2]]);
    expect(parsed.unresolved).toEqual(["无法解析行:invalid"]);
  });
  it("falls back to the first loading call when only the port is specified", () => {
    const parsed = parseNominationMail(`装港顺序:
1. 蔚山 / 3 号泊位
2. 蔚山 / 7 号泊位
卸港顺序:
3. 鹿特丹 / Botlek
货票:
1. 甲醇 · 100 MT · 蔚山 → 鹿特丹 Botlek`);
    expect(parsed.voyage.parcels[0].loadCallId).toBe("L1");
    expect(parsed.unresolved).toEqual([]);
  });
  it("preserves full display text containing a separator in a remark", () => {
    const parsed = parseNominationMail(mail("1. 正己烷 n-Hexane(上海装 · 单舱) · 100 MT · 蔚山 3 号泊位 → 鹿特丹 Botlek"));
    expect(parsed.voyage.parcels[0].display).toBe("正己烷 n-Hexane(上海装 · 单舱)");
    expect(parsed.unresolved).toEqual([]);
  });
});

describe("product catalog", () => {
  it.each([
    ["苯 Benzene(南京卸)", "benzene"], ["甲苯 Toluene", "toluene"],
    ["苯酚(熔融)Phenol", "phenol"], ["混合二甲苯 Xylene", "xylene"],
    ["正己烷 n-Hexane(上海装 · 单舱)", "hexane"], ["环己烷 Cyclohexane", "cyclohexane"],
    ["烧碱溶液 50%", "naoh"], ["MTBE", "mtbe"], ["乙二醇 MEG(鹿特丹)", "meg"],
  ])("resolves %s to %s", (text, key) => expect(resolveCatalogProduct(text)?.product.key).toBe(key));
  it("resolves all canonical names and rejects ties", () => {
    expect(PRODUCT_CATALOG).toHaveLength(19);
    for (const product of PRODUCT_CATALOG) expect(resolveCatalogProduct(product.name)?.product.key).toBe(product.key);
    expect(resolveCatalogProduct("甲醇乙醇")).toBeNull();
    expect(resolveCatalogProduct("unknown")).toBeNull();
  });
});


it("round trips explicit leg speed, port hours, water uptake and tropical zone", () => {
  const voyage = structuredClone(findSampleVoyage("single-meoh-draft")!.voyage);
  Object.assign(voyage.calls[1], { speedKn: 12.5, portHours: 18, bunkerMt: 0, freshWaterTakeMt: 50, loadLineZone: "tropical" });
  voyage.constants = { departureDate: "2026-11-01" };
  const text = formatNominationMail(voyage).body;
  expect(text).toContain("距上港 620 nm · 航速 12.5 kn · 港时 18 h · 加油 0 t · 加水 50 t · 热带区");
  const parsed = parseNominationMail(text.replace("出发日期:", "Departure:"));
  expect(parsed.voyage.calls).toEqual(voyage.calls);
  expect(parsed.voyage.constants).toEqual(voyage.constants);
});
