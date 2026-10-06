/**
 * 预配载示例航次库(演示用)。
 * 货物物性(USCG 族、密度、沸点/熔点)取自公开 MSDS/IBC 资料;航段距离、加油量、季节区与港口吃水限制为演示值,
 * 不代表实际港口公告。样船为合成数据(见 demo-ship.ts)。
 */
import type { Parcel, PortCall, StowVoyage } from "./types";
import { PRODUCT_CATALOG, type CatalogProduct, type ProductKey } from "./product-catalog";
import { SAMPLE_VOYAGE } from "./sample-voyage";

export interface SampleVoyageEntry {
  id: string;
  title: string;
  brief: string;
  voyage: StowVoyage;
}

const PRODUCTS = Object.fromEntries(
  PRODUCT_CATALOG.map(({ key, aliases, ...product }) => [key, product]),
) as Record<ProductKey, Omit<CatalogProduct, "key" | "aliases">>;

function parcel(
  id: string,
  key: ProductKey,
  quantityMt: number,
  loadCallId: string,
  dischargeCallId: string,
  extra: Partial<Parcel> = {},
): Parcel {
  const product = PRODUCTS[key];
  return {
    id,
    productId: null,
    name: product.name,
    display: product.display,
    group: product.group,
    quantityMt,
    density: product.density,
    loadCallId,
    dischargeCallId,
    heating: { enabled: false },
    boilPointC: product.boilPointC,
    meltPointC: product.meltPointC,
    polymerizable: product.polymerizable,
    maxAllowedTempC: null,
    ...extra,
  };
}

function calls(list: Array<[string, string, string, number?, number?, number?, Partial<PortCall>?]>): PortCall[] {
  return list.map(([id, port, berth, maxDraftM, waterDensity, distanceNm, extra], seq) => ({
    id,
    seq,
    port,
    berth,
    ...extra,
    ...(distanceNm != null ? { distanceNm } : {}),
    ...(maxDraftM != null ? { maxDraftM } : {}),
    ...(waterDensity != null ? { waterDensity } : {}),
  }));
}

/** 远东五港装、欧洲三港卸,12 种货物,20 个货舱全部用满。 */
const FAR_EAST_EUROPE_12: StowVoyage = {
  shipId: "sample-mr",
  voyageNo: "DEMO-2026-05",
  constants: { departureDate: "2026-11-01" },
  calls: calls([
    ["L1", "蔚山", "3 号泊位", undefined, undefined, undefined, { loadLineZone: "winter" }],
    ["L2", "蔚山", "7 号泊位", undefined, undefined, 2, { loadLineZone: "winter" }],
    ["L3", "丽水", "化学品码头 2", undefined, undefined, 170, { loadLineZone: "winter" }],
    ["L4", "大山", "Hanwha 1", undefined, undefined, 330, { loadLineZone: "winter" }],
    ["L5", "宁波", "青峙 3 号", undefined, undefined, 500, { bunkerMt: 500 }],
    ["D1", "安特卫普", "K1", 12.5, 1.025, 10500, { loadLineZone: "winter" }],
    ["D2", "鹿特丹", "Botlek", 11.8, 1.0, 90, { loadLineZone: "winter" }],
    ["D3", "汉堡", "Blumensand", 11.5, 1.0, 330, { loadLineZone: "winter" }],
  ]),
  parcels: [
    parcel("meoh", "meoh", 4660, "L1", "D2"),
    parcel("ipa", "ipa", 4560, "L1", "D1"),
    parcel("nbuoh", "nbuoh", 3690, "L2", "D3"),
    parcel("acetone", "acetone", 4580, "L2", "D2"),
    parcel("buac", "buac", 1180, "L2", "D3"),
    parcel("mek", "mek", 2060, "L3", "D3"),
    parcel("etac", "etac", 2300, "L3", "D1"),
    parcel("benzene", "benzene", 5190, "L3", "D1"),
    parcel("toluene", "toluene", 2570, "L4", "D2"),
    parcel("xylene", "xylene", 2540, "L4", "D3"),
    parcel("hexane", "hexane", 3890, "L5", "D1"),
    parcel("mtbe", "mtbe", 4370, "L5", "D2"),
  ],
};

/** 六港装、两港卸:甲醇三港分装、乙二醇两港分装,同货不同装港分票核算。 */
const SPLIT_LOADING_12: StowVoyage = {
  shipId: "sample-mr",
  voyageNo: "DEMO-2026-06",
  calls: calls([
    ["L1", "蔚山", "3 号泊位"],
    ["L2", "丽水", "化学品码头 2", undefined, undefined, 170],
    ["L3", "大山", "Hanwha 1", undefined, undefined, 330],
    ["L4", "上海", "外高桥化工", undefined, undefined, 480],
    ["L5", "宁波", "青峙 3 号", undefined, undefined, 110],
    ["L6", "高雄", "第二货柜中心 66", undefined, undefined, 470, { bunkerMt: 500 }],
    ["D1", "安特卫普", "K1", 13.0, 1.025, 9900],
    ["D2", "鹿特丹", "Botlek", 11.8, 1.0, 90],
  ]),
  parcels: [
    parcel("meoh-uls", "meoh", 4660, "L1", "D2", { display: "甲醇 Methanol(蔚山装)" }),
    parcel("meoh-yeo", "meoh", 4660, "L2", "D2", { display: "甲醇 Methanol(丽水装)" }),
    parcel("meoh-dae", "meoh", 2290, "L3", "D2", { display: "甲醇 Methanol(大山装)" }),
    parcel("meg-sha", "meg", 3220, "L4", "D1", { display: "乙二醇 MEG(上海装)" }),
    parcel("meg-nin", "meg", 5660, "L5", "D1", { display: "乙二醇 MEG(宁波装)" }),
    parcel("etoh", "etoh", 4580, "L6", "D1"),
    parcel("benzene", "benzene", 5190, "L2", "D1"),
    parcel("toluene", "toluene", 2570, "L3", "D2"),
    parcel("hexane-dae", "hexane", 1950, "L4", "D1", { display: "正己烷 n-Hexane(上海装 · 单舱)" }),
    parcel("hexane-sha", "hexane", 3000, "L4", "D2", { display: "正己烷 n-Hexane(上海装)" }),
    parcel("mtbe", "mtbe", 4370, "L5", "D1"),
    parcel("acetone", "acetone", 1060, "L6", "D2"),
  ],
};

/** 单货 · 卸港(长江张家港,淡水 10.5 m)吃水受限,求最大装载量。 */
const SINGLE_MEOH_DRAFT: StowVoyage = {
  shipId: "sample-mr",
  voyageNo: "DEMO-2026-07",
  calls: calls([
    ["L1", "蔚山", "3 号泊位"],
    ["D1", "张家港", "长江国际化工码头", 10.5, 1.0, 620],
  ]),
  parcels: [
    parcel("meoh", "meoh", 0, "L1", "D1", { intake: { mode: "priority", priority: 1 } }),
  ],
};

/** 单货 · 高密度烧碱,卸港(西贡河,9.5 m)吃水受限:重量受限而非舱容受限。 */
const SINGLE_NAOH_DRAFT: StowVoyage = {
  shipId: "sample-mr",
  voyageNo: "DEMO-2026-08",
  calls: calls([
    ["L1", "蔚山", "7 号泊位"],
    ["D1", "胡志明", "Cat Lai 液体化工泊位", 9.5, 1.005, 2300],
  ]),
  parcels: [
    parcel("naoh", "naoh", 0, "L1", "D1", { intake: { mode: "priority", priority: 1 } }),
  ],
};

/** 单货两卸港 · 第一卸港 10.5 m(淡水)、第二卸港 9.5 m,前一港受限决定总量。 */
const SINGLE_BENZENE_TWO_PORTS: StowVoyage = {
  shipId: "sample-mr",
  voyageNo: "DEMO-2026-09",
  calls: calls([
    ["L1", "丽水", "化学品码头 2"],
    ["D1", "张家港", "长江国际化工码头", 10.5, 1.0, 520],
    ["D2", "南京", "扬子石化码头", 9.5, 1.0, 120],
  ]),
  parcels: [
    parcel("benzene-njg", "benzene", 6000, "L1", "D2", { display: "苯 Benzene(南京卸)" }),
    parcel("benzene-zjg", "benzene", 0, "L1", "D1", { display: "苯 Benzene(张家港卸,尽量多)", intake: { mode: "priority", priority: 1 } }),
  ],
};

export const SAMPLE_VOYAGES: SampleVoyageEntry[] = [
  {
    id: "basic",
    title: "蔚山两泊位装 → 鹿特丹 / 安特卫普 · 6 票",
    brief: "基础示例:2 装 3 卸,含加温苯酚与两港分卸乙二醇。",
    voyage: SAMPLE_VOYAGE,
  },
  {
    id: "far-east-europe-12",
    title: "远东五港装 → 欧洲三港卸 · 12 种货物 · 满舱",
    brief: "蔚山×2 / 丽水 / 大山 / 宁波 装,安特卫普 / 鹿特丹 / 汉堡 卸;20 舱全部占用,鹿特丹、汉堡淡水吃水受限。",
    voyage: FAR_EAST_EUROPE_12,
  },
  {
    id: "split-loading-12",
    title: "六港装 → 两港卸 · 甲醇三港分装、乙二醇与正己烷分票装载",
    brief: "同一货物在多个装港分票装载,分别核算舱位与到港吃水;20 舱全部占用。",
    voyage: SPLIT_LOADING_12,
  },
  {
    id: "single-meoh-draft",
    title: "单货甲醇 → 张家港(淡水 10.5 m)· 求最大装载量",
    brief: "卸港吃水受限,票货设为「尽量多」,方案给出可装上限与受限港。",
    voyage: SINGLE_MEOH_DRAFT,
  },
  {
    id: "single-naoh-draft",
    title: "单货烧碱 50% → 胡志明(9.5 m)· 求最大装载量",
    brief: "高密度货,舱容远未用满即触到吃水上限,体现重量受限。",
    voyage: SINGLE_NAOH_DRAFT,
  },
  {
    id: "single-benzene-two-ports",
    title: "单货苯 → 张家港 10.5 m + 南京 9.5 m · 两卸港各自受限",
    brief: "南京固定 6 000 t,张家港票「尽量多」;第一卸港到港吃水决定总量。",
    voyage: SINGLE_BENZENE_TWO_PORTS,
  },
];

export function findSampleVoyage(id: string): SampleVoyageEntry | undefined {
  return SAMPLE_VOYAGES.find(entry => entry.id === id);
}
