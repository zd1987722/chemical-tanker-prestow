// ── 货物配色:同种货物同色,便于在舱图上一眼区分 ──
// 按货名排序后取色,保证编辑器/审核图/全部候选方案图颜色一致;
// 冲突(红)与未判定(黄)底色优先级高于货物色,不遮安全信号。
export const CARGO_PALETTE = [
  "#3f6aa8",
  "#2f7f8f",
  "#956329",
  "#8a5fa4",
  "#34764c",
  "#a4566a",
];
export function cargoColorMap(
  names: (string | undefined | null)[]
): Record<string, string> {
  const uniq = Array.from(
    new Set(names.filter((n): n is string => !!n))
  ).sort();
  const m: Record<string, string> = {};
  uniq.forEach((n, i) => (m[n] = CARGO_PALETTE[i % CARGO_PALETTE.length]));
  return m;
}
