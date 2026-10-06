export const X1_TABLE: [number, number][] = [
  [2.4, 1],
  [2.5, 0.98],
  [2.6, 0.96],
  [2.7, 0.95],
  [2.8, 0.93],
  [2.9, 0.91],
  [3, 0.9],
  [3.1, 0.88],
  [3.2, 0.86],
  [3.4, 0.82],
  [3.5, 0.8],
];

export const X2_TABLE: [number, number][] = [
  [0.45, 0.75],
  [0.5, 0.82],
  [0.55, 0.89],
  [0.6, 0.95],
  [0.65, 0.97],
  [0.7, 1],
];

export const S_TABLE: [number, number][] = [
  [6, 0.1],
  [7, 0.098],
  [8, 0.093],
  [12, 0.065],
  [14, 0.053],
  [16, 0.044],
  [18, 0.038],
  [20, 0.035],
];

export function interp(table: [number, number][], value: number): number {
  if (value <= table[0][0]) return table[0][1];
  if (value >= table[table.length - 1][0]) return table[table.length - 1][1];

  const upper = table.findIndex(([x]) => x >= value);
  const [x0, y0] = table[upper - 1];
  const [x1, y1] = table[upper];
  return y0 + (value - x0) / (x1 - x0) * (y1 - y0);
}
