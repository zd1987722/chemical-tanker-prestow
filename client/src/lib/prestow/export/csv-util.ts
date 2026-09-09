export const BOM = "\uFEFF";
export const EOL = "\r\n";
/** 货名/港名来自邮件等不可信文本:以 = + - @ 或制表符开头的非数值串会被表格软件当公式,前置单引号并加引号。 */
function neutralizeFormula(s: string): string {
  return /^[=+\-@\t\r]/.test(s) && !/^[-+]?(\d+([.,]\d+)?|[.,]\d+)(e[-+]?\d+)?$/i.test(s) ? `'${s}` : s;
}
export function csvCell(v: string | number | null | undefined): string {
  if (v == null) return "";
  const raw = String(v);
  const s = typeof v === "string" ? neutralizeFormula(raw) : raw;
  return /[",\r\n]/.test(s) || s !== raw ? `"${s.replace(/"/g, '""')}"` : s;
}
export function csvLine(cells: (string | number | null | undefined)[]): string {
  return cells.map(csvCell).join(",");
}
export const f1 = (n: number) => n.toFixed(1);
export const f4 = (n: number) => n.toFixed(4);
