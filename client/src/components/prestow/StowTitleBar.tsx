import { useRef } from "react";
import { AlertTriangle, Loader2, Mail } from "lucide-react";
import { MButton, MCard, StatusBadge } from "@/components/maritime";
import type { AppendixIExceptionStatus } from "@/lib/appendix-i-exceptions";
import { SAMPLE_VOYAGES } from "@/lib/prestow/sample-voyages";

export function StowTitleBar({
  solving,
  appendixStatus,
  onSolve,
  onReset,
  onLoadSample,
  onImportMail,
  resultSummary,
  voyageSummary,
}: {
  solving: boolean;
  appendixStatus: AppendixIExceptionStatus;
  onSolve(): void;
  onReset(): void;
  onLoadSample(id: string): void;
  onImportMail(file: File): void;
  resultSummary?: string;
  voyageSummary: string;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const loaded = appendixStatus === "loaded";
  const appendixMessage = loaded
    ? "相容性例外 已加载"
    : appendixStatus === "failed"
      ? "相容性例外加载失败，无法求解，请刷新"
      : "相容性例外加载中…";

  return (
    <MCard className="stow-titlebar">
      <div className="stow-titlebar-eyebrow">
        <span className="stow-titlebar-kicker">PRE-STOWAGE</span>
        <i aria-hidden="true" />
        <span className="stow-titlebar-ship">虚构船 · MR 型油化船</span>
        <StatusBadge state="warn">样船(合成数据)</StatusBadge>
        <span
          className={
            "stow-engine-status" +
            (loaded ? " stow-engine-loaded" : appendixStatus === "failed" ? " stow-engine-failed" : "")
          }
        >
          {appendixStatus === "failed" ? <AlertTriangle size={13} /> : !loaded && <Loader2 size={13} className="animate-spin" />}
          {appendixMessage}
        </span>
      </div>
      <div className="stow-titlebar-main">
        <h1>多票货预配载</h1>
        <span className="stow-current-voyage" title={voyageSummary}>{voyageSummary}</span>
        <p>
          快速结果不替代完整稳性、强度校核；选中方案逐站按静水力精算，最终以
          Loadicator 为准。
        </p>
        {resultSummary && <span className="stow-titlebar-result">{resultSummary}</span>}
        <div className="stow-titlebar-actions">
          <label className="stow-sample-field">
            <span>示例航次</span>
            <select
              className="stow-sample-select stow-sample-select-hero"
              aria-label="载入示例航次"
              value=""
              onChange={event => {
                const id = event.target.value;
                event.currentTarget.value = "";
                if (id) onLoadSample(id);
              }}
            >
              <option value="">选择预设航次计划…</option>
              {SAMPLE_VOYAGES.map(entry => (
                <option key={entry.id} value={entry.id} title={entry.brief}>
                  {entry.title}
                </option>
              ))}
            </select>
          </label>
          <input ref={fileInput} type="file" accept=".msg" hidden onChange={event => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) onImportMail(file);
          }} />
          <MButton type="button" variant="ghost" icon={Mail} onClick={() => fileInput.current?.click()}>
            导入邮件(.msg)
          </MButton>
          <MButton
            type="button"
            onClick={onSolve}
            disabled={solving || !loaded}
          >
            {solving && <Loader2 size={16} className="animate-spin" />}
            {solving ? "计算中…" : "生成方案"}
          </MButton>
          <MButton type="button" variant="ghost" onClick={onReset}>
            清空
          </MButton>
        </div>
      </div>
    </MCard>
  );
}
