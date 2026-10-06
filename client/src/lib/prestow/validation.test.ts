import { describe, expect, it } from "vitest";
import { DEMO_STOW_SHIP } from "./demo-ship";
import { prepareParcels, solvePrestow, validateVoyage, validateVoyageIssues } from "./engine";
import { SAMPLE_VOYAGE } from "./sample-voyage";
import { draftIssues, validationAttrs, validationTargetId } from "../../components/prestow/validation";

describe("校验错误定位", () => {
  it("两港一票的草稿在确认前提示缺失密度，并统一演示船型", () => {
    const voyage = structuredClone(SAMPLE_VOYAGE);
    voyage.shipId = "待确认船型";
    voyage.calls = voyage.calls.slice(0, 2);
    voyage.parcels = [{ ...voyage.parcels[0], loadCallId: voyage.calls[0].id, dischargeCallId: voyage.calls[1].id, density: 0 }];
    const issues = draftIssues(voyage);
    expect(issues).toEqual([expect.objectContaining({ target: { section: "parcels", index: 0, field: "density" } })]);
    expect(voyage.shipId).toBe("待确认船型");
  });

  it("完整示例航次的草稿校验无问题", () => {
    expect(draftIssues(SAMPLE_VOYAGE)).toEqual([]);
  });

  it("优先级票数量为零且无关意向字段全零时无校验错误", () => {
    const voyage = structuredClone(SAMPLE_VOYAGE);
    voyage.parcels[0].quantityMt = 0;
    voyage.parcels[0].intake = { mode: "priority", priority: 2, ratio: 0, minMt: 0, maxMt: 0 };
    expect(validateVoyageIssues(DEMO_STOW_SHIP, voyage)).toEqual([]);
  });

  it("固定票数量为零时仍提示数量必须大于零", () => {
    const voyage = structuredClone(SAMPLE_VOYAGE);
    voyage.parcels[0].quantityMt = 0;
    voyage.parcels[0].intake = { mode: "fixed", priority: 0, ratio: 0, minMt: 0, maxMt: 0 };
    expect(validateVoyageIssues(DEMO_STOW_SHIP, voyage)).toEqual([{
      message: `${voyage.parcels[0].display}:数量必须大于 0`,
      target: { section: "parcels", index: 0, field: "quantityMt" },
    }]);
  });

  it("区间票最高吨数为零时仍定位最高吨数字段", () => {
    const voyage = structuredClone(SAMPLE_VOYAGE);
    voyage.parcels[0].quantityMt = 0;
    voyage.parcels[0].intake = { mode: "range", minMt: 0, maxMt: 0 };
    expect(validateVoyageIssues(DEMO_STOW_SHIP, voyage)).toEqual([{
      message: `${voyage.parcels[0].display}:最高吨数无效`,
      target: { section: "parcels", index: 0, field: "maxMt" },
    }]);
  });

  it.each([
    { mode: "fixed", priority: NaN, ratio: 0, minMt: -1, maxMt: 0 },
    { mode: "ratio", priority: NaN, ratio: 2, minMt: -1, maxMt: 0 },
    { mode: "range", priority: NaN, ratio: 0, minMt: 0, maxMt: 8000 },
  ] as const)("$mode 模式忽略无关的非法意向字段", intake => {
    const voyage = structuredClone(SAMPLE_VOYAGE);
    voyage.parcels[0].intake = intake;
    if (intake.mode !== "fixed") voyage.parcels[0].quantityMt = 0;
    expect(validateVoyageIssues(DEMO_STOW_SHIP, voyage)).toEqual([]);
  });

  it.each([
    { intake: { mode: "priority", priority: Infinity }, field: "priority", message: "优先级无效" },
    { intake: { mode: "ratio", ratio: NaN }, field: "ratio", message: "比例必须大于 0" },
    { intake: { mode: "range", minMt: -1 }, field: "minMt", message: "最低吨数无效" },
    { intake: { mode: "range", maxMt: Infinity }, field: "maxMt", message: "最高吨数无效" },
  ] as const)("相关字段 $field 非法时保留错误文案与定位", ({ intake, field, message }) => {
    const voyage = structuredClone(SAMPLE_VOYAGE);
    voyage.parcels[0].quantityMt = 0;
    voyage.parcels[0].intake = intake;
    expect(validateVoyageIssues(DEMO_STOW_SHIP, voyage)).toEqual([{
      message: `${voyage.parcels[0].display}:${message}`,
      target: { section: "parcels", index: 0, field },
    }]);
  });

  it("同名分票按原始索引定位，不根据货名匹配", () => {
    const voyage = structuredClone(SAMPLE_VOYAGE);
    voyage.parcels[1].display = voyage.parcels[0].display;
    voyage.parcels[1].quantityMt = 0;
    const issue = validateVoyageIssues(DEMO_STOW_SHIP, voyage).find(item => item.message.endsWith("数量必须大于 0"))!;
    expect(issue.target).toEqual({ section: "parcels", index: 1, field: "quantityMt" });
    expect(validationAttrs([issue], issue.target)).toMatchObject({ "aria-invalid": true, "aria-describedby": "stow-error-0" });
    expect(validationAttrs([issue], { ...issue.target, index: 0 })["aria-invalid"]).toBeUndefined();
  });

  it("相同港名及未排序停靠点仍指向实际错误行", () => {
    const voyage = structuredClone(SAMPLE_VOYAGE);
    voyage.calls.reverse();
    voyage.calls[1].port = voyage.calls[0].port;
    voyage.calls[1].maxDraftM = -1;
    const issue = validateVoyageIssues(DEMO_STOW_SHIP, voyage).find(item => item.target.field === "maxDraftM")!;
    expect(issue.target).toEqual({ section: "calls", index: 1, field: "maxDraftM" });
  });

  it("意向求解过滤零装载票后，错误仍定位原输入行", () => {
    const voyage = structuredClone(SAMPLE_VOYAGE);
    voyage.parcels = voyage.parcels.slice(0, 2);
    voyage.parcels[0].intake = { mode: "priority", priority: 1 };
    voyage.parcels[1].density = 0;
    const result = solvePrestow(DEMO_STOW_SHIP, voyage, { limit: 10, maxPlans: 1 });
    expect(result.status).toBe("invalid");
    if (result.status !== "invalid") throw new Error("Expected input error");
    expect(result.issues?.find(issue => issue.message.endsWith("密度必须大于 0"))?.target).toEqual({ section: "parcels", index: 1, field: "density" });
  });

  it("折叠字段和航次常数携带字段键，多条错误关联同一控件", () => {
    const voyage = structuredClone(SAMPLE_VOYAGE);
    voyage.parcels[0].density = 0;
    voyage.parcels[0].heating = { enabled: true, carriageTempC: NaN };
    voyage.constants = { serviceSpeedKn: 0 };
    const issues = validateVoyageIssues(DEMO_STOW_SHIP, voyage);
    expect(issues.map(item => item.target.field)).toEqual(expect.arrayContaining(["density", "carriageTempC", "serviceSpeedKn"]));
    const repeated = [issues[0], issues[0]];
    expect(validationAttrs(repeated, repeated[0].target)["aria-describedby"]).toBe("stow-error-0 stow-error-1");
  });

  it("保持原有错误字符串和排序，求解结果附带可克隆的定位信息", () => {
    const voyage = structuredClone(SAMPLE_VOYAGE);
    voyage.calls[0].waterDensity = 2;
    const issues = validateVoyageIssues(DEMO_STOW_SHIP, voyage);
    expect(validateVoyage(DEMO_STOW_SHIP, voyage)).toEqual(issues.map(issue => issue.message));
    expect(prepareParcels(DEMO_STOW_SHIP, voyage)).toEqual({ errors: issues.map(issue => issue.message), issues });
    expect(structuredClone(solvePrestow(DEMO_STOW_SHIP, voyage))).toMatchObject({ status: "invalid", issues });
  });

  it("空航次及总体积错误定位到区域，不误标某一货票", () => {
    const voyage = { ...structuredClone(SAMPLE_VOYAGE), calls: [], parcels: [] };
    const issues = validateVoyageIssues(DEMO_STOW_SHIP, voyage);
    expect(issues.map(issue => issue.target)).toEqual([{ section: "parcels" }, { section: "calls" }]);
    expect(validationTargetId(issues[0].target)).toBe("stow-input-parcels-all-row");
    const large = structuredClone(SAMPLE_VOYAGE);
    large.parcels[0].quantityMt = 100000;
    expect(validateVoyageIssues(DEMO_STOW_SHIP, large).find(issue => issue.message.startsWith("总体积"))?.target).toEqual({ section: "parcels" });
  });
});
