import { describe, expect, it } from "vitest";
import { scenarioMode } from "./validation";

describe("解析模式选择", () => {
  it("尚无状态且加载中时等待检测", () => {
    expect(scenarioMode(undefined, true)).toBe("checking");
  });

  it("已配置时只使用 AI 解析", () => {
    expect(scenarioMode({ available: true }, false)).toBe("ai");
    expect(scenarioMode({ available: true }, true)).toBe("ai");
  });

  it("明确未配置时使用规则解析", () => {
    expect(scenarioMode({ available: false }, false)).toBe("rules");
    expect(scenarioMode({ available: false }, true)).toBe("rules");
  });

  it("查询失败且无状态时回退规则解析", () => {
    expect(scenarioMode(undefined, false)).toBe("rules");
  });
});
