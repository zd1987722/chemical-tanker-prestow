export type ProductKey =
  | "meoh" | "meg" | "etoh" | "ipa" | "nbuoh"
  | "acetone" | "mek"
  | "etac" | "buac"
  | "benzene" | "toluene" | "xylene"
  | "hexane" | "cyclohexane" | "mtbe" | "styrene"
  | "naoh" | "phenol" | "acn";

export interface CatalogProduct {
  key: ProductKey;
  name: string;
  display: string;
  group: number;
  density: number;
  boilPointC: number;
  meltPointC: number;
  polymerizable: boolean;
  aliases: string[];
}

export const PRODUCT_CATALOG: CatalogProduct[] = [
  { key: "meoh", name: "METHANOL", display: "甲醇 Methanol", group: 20, density: 0.79, boilPointC: 64.7, meltPointC: -97.6, polymerizable: false, aliases: ["甲醇", "methanol", "meoh"] },
  { key: "meg", name: "ETHYLENE GLYCOL", display: "乙二醇 MEG", group: 20, density: 1.11, boilPointC: 197.3, meltPointC: -13, polymerizable: false, aliases: ["乙二醇", "ethylene glycol", "meg", "mono ethylene glycol"] },
  { key: "etoh", name: "ETHANOL", display: "乙醇 Ethanol", group: 20, density: 0.79, boilPointC: 78.4, meltPointC: -114, polymerizable: false, aliases: ["乙醇", "ethanol", "etoh"] },
  { key: "ipa", name: "ISOPROPYL ALCOHOL", display: "异丙醇 IPA", group: 20, density: 0.786, boilPointC: 82.5, meltPointC: -89, polymerizable: false, aliases: ["异丙醇", "isopropyl alcohol", "isopropanol", "ipa"] },
  { key: "nbuoh", name: "N-BUTYL ALCOHOL", display: "正丁醇 n-Butanol", group: 20, density: 0.81, boilPointC: 117.7, meltPointC: -89.8, polymerizable: false, aliases: ["正丁醇", "n-butyl alcohol", "n-butanol", "nbuoh"] },
  { key: "acetone", name: "ACETONE", display: "丙酮 Acetone", group: 18, density: 0.79, boilPointC: 56.1, meltPointC: -94.7, polymerizable: false, aliases: ["丙酮", "acetone"] },
  { key: "mek", name: "METHYL ETHYL KETONE", display: "甲基乙基酮 MEK", group: 18, density: 0.805, boilPointC: 79.6, meltPointC: -86, polymerizable: false, aliases: ["甲基乙基酮", "丁酮", "mek", "methyl ethyl ketone"] },
  { key: "etac", name: "ETHYL ACETATE", display: "乙酸乙酯 Ethyl acetate", group: 34, density: 0.9, boilPointC: 77.1, meltPointC: -83.6, polymerizable: false, aliases: ["乙酸乙酯", "ethyl acetate", "etac"] },
  { key: "buac", name: "N-BUTYL ACETATE", display: "乙酸丁酯 Butyl acetate", group: 34, density: 0.88, boilPointC: 126, meltPointC: -78, polymerizable: false, aliases: ["乙酸丁酯", "butyl acetate", "buac"] },
  { key: "benzene", name: "BENZENE", display: "苯 Benzene", group: 32, density: 0.88, boilPointC: 80.1, meltPointC: 5.5, polymerizable: false, aliases: ["苯", "benzene"] },
  { key: "toluene", name: "TOLUENE", display: "甲苯 Toluene", group: 32, density: 0.87, boilPointC: 110.6, meltPointC: -95, polymerizable: false, aliases: ["甲苯", "toluene"] },
  { key: "xylene", name: "XYLENES", display: "混合二甲苯 Xylene", group: 32, density: 0.86, boilPointC: 139, meltPointC: -47, polymerizable: false, aliases: ["二甲苯", "xylene", "xylenes"] },
  { key: "hexane", name: "N-HEXANE", display: "正己烷 n-Hexane", group: 31, density: 0.66, boilPointC: 68.7, meltPointC: -95.3, polymerizable: false, aliases: ["正己烷", "n-hexane", "hexane"] },
  { key: "cyclohexane", name: "CYCLOHEXANE", display: "环己烷 Cyclohexane", group: 31, density: 0.78, boilPointC: 80.7, meltPointC: 6.5, polymerizable: false, aliases: ["环己烷", "cyclohexane"] },
  { key: "mtbe", name: "METHYL TERT-BUTYL ETHER", display: "MTBE", group: 41, density: 0.74, boilPointC: 55.2, meltPointC: -109, polymerizable: false, aliases: ["甲基叔丁基醚", "methyl tert-butyl ether", "mtbe"] },
  { key: "styrene", name: "STYRENE MONOMER", display: "苯乙烯 Styrene", group: 30, density: 0.91, boilPointC: 145, meltPointC: -30.6, polymerizable: true, aliases: ["苯乙烯", "styrene", "sm"] },
  { key: "naoh", name: "SODIUM HYDROXIDE SOLUTION", display: "烧碱溶液 50%", group: 5, density: 1.52, boilPointC: 140, meltPointC: 12, polymerizable: false, aliases: ["烧碱", "caustic soda", "sodium hydroxide", "naoh"] },
  { key: "phenol", name: "PHENOL", display: "苯酚(熔融)Phenol", group: 21, density: 1.05, boilPointC: 181.7, meltPointC: 40.9, polymerizable: false, aliases: ["苯酚", "phenol"] },
  { key: "acn", name: "ACRYLONITRILE", display: "丙烯腈 Acrylonitrile", group: 15, density: 0.81, boilPointC: 77.3, meltPointC: -83.5, polymerizable: true, aliases: ["丙烯腈", "acrylonitrile", "acn"] },
];

export function resolveCatalogProduct(text: string): { product: CatalogProduct; score: number } | null {
  const normalize = (s: string) => s.toLowerCase().replace(/[\s\-_·,.()（）/]/g, "");
  const normalized = normalize(text);
  let best: { product: CatalogProduct; score: number } | null = null;
  let tied = false;
  for (const product of PRODUCT_CATALOG) {
    const score = Math.max(0, ...product.aliases.map(alias => {
      const key = normalize(alias);
      return normalized.includes(key) ? key.length : 0;
    }));
    if (score > (best?.score ?? 0)) {
      best = { product, score };
      tied = false;
    } else if (score > 0 && score === best?.score) {
      tied = true;
    }
  }
  return tied ? null : best;
}
