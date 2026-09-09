import { useEffect, useMemo, useRef, useState } from "react";
import type { ScenarioAiParseTrackProps } from "@shared/track";
import { track } from "@/lib/track";
import { AlertTriangle, Check, Mail, Sparkles } from "lucide-react";
import { MButton, MCard } from "@/components/maritime";
import { SAMPLE_EMAIL } from "@/lib/prestow/sample-scenario";
import { SAMPLE_VOYAGES } from "@/lib/prestow/sample-voyages";
import { parseNominationMail } from "@/lib/prestow/mail-parse";
import type { ImportedMail } from "@/lib/prestow/msg-import";
import type { StowVoyage } from "@/lib/prestow/types";
import { trpc } from "@/lib/trpc";
import { draftIssues, scenarioMode } from "./validation";

export function ScenarioPanel({
  onApply,
  incomingFile,
  onFileConsumed,
}: {
  onApply(voyage: StowVoyage, unresolved: string[]): void;
  incomingFile?: File | null;
  onFileConsumed?(): void;
}) {
  const [open, setOpen] = useState(false);
  const [mail, setMail] = useState<ImportedMail | null>(null);
  const [mailLoading, setMailLoading] = useState(false);
  const [demoLoading, setDemoLoading] = useState<string | null>(null);
  const [warning, setWarning] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const consumedFile = useRef<File | null>(null);
  const requestId = useRef(0);
  const parsedSource = useRef<"rule" | "ai">("rule");
  const [text, setText] = useState("");
  const [pendingVoyage, setPendingVoyage] = useState<StowVoyage | null>(null);
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const aiStatus = trpc.prestow.aiStatus.useQuery(undefined, { staleTime: Infinity, retry: 1 });
  const mode = scenarioMode(aiStatus.data, aiStatus.isLoading);
  const parseScenario = trpc.prestow.parseScenario.useMutation();
  const inputsDisabled = mode === "checking" || mailLoading || demoLoading !== null || parseScenario.isPending;
  const issues = useMemo(() => pendingVoyage ? draftIssues(pendingVoyage) : [], [pendingVoyage]);

  const clearParsed = () => {
    requestId.current++;
    setPendingVoyage(null);
    setUnresolved([]);
    setError(null);
    setWarning(false);
  };
  const parseRules = (source: string) => {
    clearParsed();
    const parsed = parseNominationMail(source);
    parsedSource.current = "rule";
    const empty = parsed.matched.calls === 0 || parsed.matched.parcels === 0;
    setWarning(empty);
    setUnresolved(parsed.unresolved);
    if (!empty) setPendingVoyage(parsed.voyage);
    return parsed;
  };
  const parse = async (source: string, trigger: "button" | "sample" | "mail") => {
    track("scenario_ai_parse", { chars: source.length, trigger } satisfies ScenarioAiParseTrackProps);
    clearParsed();
    const id = requestId.current;
    try {
      const parsed = await parseScenario.mutateAsync({ text: source });
      if (id !== requestId.current) return;
      if (!parsed.available) {
        setError("AI 解析暂不可用,请稍后重试");
        return;
      }
      setPendingVoyage(parsed.voyage);
      parsedSource.current = "ai";
      setUnresolved(parsed.unresolved);
      return parsed;
    } catch (reason) {
      if (id !== requestId.current) return;
      track("mail_import_error", { reason: "ai_parse_failed" });
      setError(
        reason instanceof Error && "data" in reason && reason.data != null
          ? reason.message : "AI 解析失败,请稍后重试或手工录入"
      );
    }
  };
  const analyze = (source: string, trigger: "button" | "sample" | "mail") => {
    if (mode === "ai") return parse(source, trigger);
    if (mode === "rules") return parseRules(source);
  };
  const importMail = async (file: File) => {
    if (mode === "checking" || parseScenario.isPending) return;
    setOpen(true);
    setMailLoading(true);
    clearParsed();
    setMail(null);
    const id = requestId.current;
    try {
      // .msg 解析器(msgreader + iconv-lite + buffer ≈ 300 KB)只在真正导入时下载
      const [{ readMsgFile }, buffer] = await Promise.all([import("@/lib/prestow/msg-import"), file.arrayBuffer()]);
      const imported = readMsgFile(buffer);
      if (id !== requestId.current) return;
      const source = `主题: ${imported.subject}${imported.senderName || imported.senderEmail ? `\n发件人: ${imported.senderName}${imported.senderEmail ? ` <${imported.senderEmail}>` : ""}` : ""}\n\n${imported.body}`;
      setMail({ ...imported, fileName: file.name });
      setText(source);
      const parsed = await analyze(source, "mail");
      track("mail_import", { file: file.name.slice(0, 60), mode, calls: parsed?.voyage.calls.length ?? 0, parcels: parsed?.voyage.parcels.length ?? 0, unresolved: parsed?.unresolved.length ?? 0 });
    } catch (reason) {
      if (id !== requestId.current) return;
      track("mail_import_error", { reason: "mail_read_or_parse_failed" });
      setError(reason instanceof Error ? reason.message : "邮件读取失败");
    } finally {
      setMailLoading(false);
    }
  };

  const importDemoMail = async (entryId: string) => {
    setDemoLoading(entryId);
    setOpen(true);
    clearParsed();
    const id = requestId.current;
    try {
      const response = await fetch(`/demo-mails/${entryId}.msg`);
      if (!response.ok) throw new Error("示例邮件加载失败");
      const file = new File([await response.blob()], `demo:${entryId}.msg`, { type: "application/vnd.ms-outlook" });
      if (id !== requestId.current) return;
      await importMail(file);
    } catch (reason) {
      if (id !== requestId.current) return;
      setError(reason instanceof Error ? reason.message : "示例邮件加载失败");
      track("mail_import_error", { reason: "demo_fetch_failed" });
    } finally {
      setDemoLoading(null);
    }
  };

  useEffect(() => {
    if (!incomingFile || incomingFile === consumedFile.current || inputsDisabled) return;
    consumedFile.current = incomingFile;
    void importMail(incomingFile);
    onFileConsumed?.();
  }, [incomingFile, mode, inputsDisabled]);

  return (
    <MCard className="stow-section stow-collapsible-card">
      <details open={open} onToggle={event => setOpen(event.currentTarget.open)}>
        <summary>
          <span className="stow-summary-title">
            <Sparkles size={16} />
            导入租家邮件 / 粘贴 scenario
          </span>
          <small>{mode === "ai"
            ? ".msg 或粘贴文字,由 AI 解析为航次草稿,确认后才覆盖"
            : mode === "rules"
              ? ".msg 或粘贴文字,规则解析为航次草稿,确认后才覆盖 · 本站未配置 AI 解析"
              : ".msg 或文字,规则解析或 AI 解析为航次草稿,确认后才覆盖"}</small>
        </summary>
        <div className="stow-scenario-body">
          <label className="stow-field">
            <span>邮件或文字（最多 4,000 字）</span>
            <textarea
              value={text}
              maxLength={4000}
              onChange={event => {
                setText(event.target.value);
                clearParsed();
                setMail(null);
              }}
              placeholder="粘贴装卸港、泊位、票货、吨数意向、吃水和水密度要求…"
            />
          </label>
          {mail && <div className="stow-mail-meta">已读取 {mail.fileName} · 主题 {mail.subject} · 正文 {mail.body.length} 字</div>}
          <div className="stow-scenario-actions">
            <input ref={fileInput} type="file" accept=".msg" hidden disabled={inputsDisabled} onChange={event => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = "";
              if (file) void importMail(file);
            }} />
            <MButton type="button" variant="soft" size="sm" icon={Mail} disabled={inputsDisabled} onClick={() => fileInput.current?.click()}>导入 .msg 邮件</MButton>
            {mode === "ai" ? (
              <MButton type="button" size="sm" icon={Sparkles}
                disabled={text.trim() === "" || parseScenario.isPending} onClick={() => void analyze(text, "button")}>
                {parseScenario.isPending ? "解析中…" : "AI 解析"}
              </MButton>
            ) : mode === "rules" ? (
              <MButton type="button" size="sm" disabled={text.trim() === ""} onClick={() => void analyze(text, "button")}>规则解析</MButton>
            ) : (
              <MButton type="button" size="sm" disabled>检测解析服务…</MButton>
            )}
            <MButton
              type="button"
              variant="soft"
              size="sm"
              icon={Mail}
              disabled={inputsDisabled}
              onClick={() => {
                setText(SAMPLE_EMAIL);
                clearParsed();
                setMail(null);
                if (mode === "ai") void parse(SAMPLE_EMAIL, "sample");
              }}
            >
              {mode === "ai" ? "载入示例并 AI 解析" : "载入示例邮件"}
            </MButton>
            {mode === "rules" && <small>示例为自由文本,需 AI 解析</small>}
            <span>{text.length} / 4000</span>
          </div>
          {parseScenario.isPending && <p className="stow-ai-progress" role="status">AI 解析中,通常 5–15 秒,最长 60 秒</p>}

          {warning && <div className="stow-result-banner stow-result-warning">
            <AlertTriangle size={16} /><span>未识别为标准配载申请格式,请手工录入</span>
          </div>}

          {error && (
            <div className="stow-result-banner stow-result-danger">
              <AlertTriangle size={16} />
              <span>{error}</span>
            </div>
          )}
          {pendingVoyage && (
            <div className="stow-scenario-confirm">
              <div>
                <strong>解析完成</strong>
                <span>
                  {pendingVoyage.calls.length} 个停靠点，
                  {pendingVoyage.parcels.length} 票货
                </span>
                <p>将覆盖当前航次；请检查下方未解析项后再确认。</p>
                {issues.length > 0 && <>
                  <strong>确认后需补齐 {issues.length} 项才能生成方案</strong>
                  <ul className="stow-draft-issues">
                    {issues.slice(0, 5).map((issue, index) => <li key={index}>{issue.message}</li>)}
                    {issues.length > 5 && <li>…还有 {issues.length - 5} 项</li>}
                  </ul>
                </>}
              </div>
              <MButton
                type="button"
                size="sm"
                icon={Check}
                onClick={() => {
                  onApply(pendingVoyage, unresolved);
                  track("scenario_apply", { calls: pendingVoyage.calls.length, parcels: pendingVoyage.parcels.length, source: parsedSource.current });
                  setPendingVoyage(null);
                }}
              >
                确认覆盖当前航次
              </MButton>
            </div>
          )}
          {unresolved.length > 0 && (
            <div className="stow-unresolved-list">
              <strong>未解析项</strong>
              <ul>
                {unresolved.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="stow-mail-links">
            <strong>演示邮件(.msg)</strong>
            <ul>{SAMPLE_VOYAGES.map(entry => (
              <li key={entry.id}>
                <a href={`/demo-mails/${entry.id}.msg`} download={`配载申请-${entry.voyage.voyageNo}.msg`} onClick={() => track("demo_mail_download", { id: entry.id })}>{entry.title}</a>
                <MButton type="button" variant="ghost" size="sm" disabled={inputsDisabled} onClick={() => void importDemoMail(entry.id)}>
                  {demoLoading === entry.id ? "导入中…" : "直接导入"}
                </MButton>
              </li>
            ))}</ul>
            <p>点「直接导入」体验解析流程；也可下载后在 Outlook 中打开查看</p>
          </div>
        </div>
      </details>
    </MCard>
  );
}
