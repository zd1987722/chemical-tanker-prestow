import { afterAll, describe, it, expect } from "vitest";
import { SAMPLE_SHIP } from "./sample-ship";
import { SAMPLE_VOYAGE } from "./sample-voyage";
import { resetRuntimeExceptionsForTest, setRuntimeExceptions } from "../appendix-i-exceptions";
import { solvePrestow } from "./engine";
import { EXPORTERS, renderSummaryCsv } from "./export";
import { csvLine } from "./export/csv-util";

setRuntimeExceptions([], []);
afterAll(() => resetRuntimeExceptionsForTest());

const result = solvePrestow(SAMPLE_SHIP, SAMPLE_VOYAGE, { maxPlans: 5 });
if (result.status === "invalid") throw new Error("sample invalid");
const csv = EXPORTERS.find(e => e.id === "generic-csv")!;

describe("csvLine", () => {
  it("含逗号/引号/换行的字段加引号并转义", () => {
    expect(csvLine(["a", "b,c", 'd"e', 1.5])).toBe('a,"b,c","d""e",1.5');
  });
});

describe("generic-csv", () => {
  const file = csv.render(result.plans[0], 1, SAMPLE_SHIP, SAMPLE_VOYAGE);
  it("文件名、BOM、注释行、列头", () => {
    expect(file.filename).toBe("SAMPLE-2026-01_plan01.csv");
    expect(file.mime).toBe("text/csv;charset=utf-8");
    expect(file.content.startsWith("\uFEFF# 样船(合成数据)")).toBe(true);
    const lines = file.content.replace("\uFEFF", "").split("\r\n");
    expect(lines[1]).toMatch(/^# 预配载方案 rank=1 key=/);
    expect(lines[2]).toBe("# 力矩类数值为预估值,以 Loadicator 为准");
    expect(lines[3]).toBe("stage_seq,port,berth,tank,tank_label,parcel,fill_pct,volume_m3,density,temp_c,weight_mt,ETA 天,ETD 天,航段 nm,到港燃油 ROB,离港燃油 ROB,到港淡水 ROB,离港淡水 ROB,限值来源");
  });
  it("每阶段 20 货舱 + 实际压载舱 + 1 TOTAL 行;压载行紧邻 TOTAL 前", () => {
    const lines = file.content.replace("\uFEFF", "").split("\r\n").filter(l => l && !l.startsWith("#")).slice(1);
    const ballastCount = result.plans[0].stages.reduce(
      (sum, stage) => sum + (stage.floating?.ballastTanks.length ?? 0),
      0
    );
    expect(lines.length).toBe(SAMPLE_VOYAGE.calls.length * 21 + ballastCount);
    const totals = lines.filter(l => l.split(",")[3] === "TOTAL");
    expect(totals).toHaveLength(SAMPLE_VOYAGE.calls.length);
    for (const stage of result.plans[0].stages) {
      const call = SAMPLE_VOYAGE.calls.find(item => item.id === stage.callId)!;
      const stageLines = lines.filter(line => line.split(",")[0] === String(call.seq));
      expect(stageLines.at(-1)?.split(",")[3]).toBe("TOTAL");
      const ballastLines = stageLines.filter(line => line.split(",")[5] === "BALLAST");
      expect(ballastLines).toHaveLength(stage.floating?.ballastTanks.length ?? 0);
      expect(ballastLines.every(line => line.split(",")[8] === "1.0250")).toBe(true);
    }
    const lastCargoLines = lines.filter(line => {
      const columns = line.split(",");
      return columns[0] === "4" && /^\d+[PS]$/.test(columns[3]);
    });
    expect(lastCargoLines).toHaveLength(20);
    expect(lastCargoLines.every(line => line.split(",")[6] === "0.0")).toBe(true);
  });
  it("快照", () => {
    expect(file.content).toMatchSnapshot();
  });
});

describe("summary-csv", () => {
  const file = renderSummaryCsv(result, SAMPLE_SHIP, SAMPLE_VOYAGE);
  it("一行一方案 + 末行 status", () => {
    const lines = file.content.replace("\uFEFF", "").split("\r\n").filter(Boolean);
    expect(lines[0]).toBe("rank,key,tanks_used,unpaired,max_heel_tm,max_lcg_shift_m,advisories,allocations");
    expect(lines.length).toBe(1 + result.plans.length + 1);
    expect(lines[lines.length - 1]).toBe(`# status=${result.status} totalFound=${result.totalFound}`);
    expect(lines[1].split(",")[0]).toBe("1");
  });
  it("快照", () => {
    expect(file.content).toMatchSnapshot();
  });
});
