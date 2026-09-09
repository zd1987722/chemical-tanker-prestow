import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { readMsgFile } from "./msg-import";
import { parseNominationMail } from "./mail-parse";
import { findSampleVoyage } from "./sample-voyages";
import type { Parcel } from "./types";

const directory = "client/public/demo-mails";
const files = existsSync(directory) ? readdirSync(directory).filter(name => /\.msg$/i.test(name)) : [];
const equivalent = ({ id, intake, ...parcel }: Parcel) => ({ ...parcel, ...(intake && intake.mode !== "fixed" ? { intake } : {}) });

it.skipIf(files.length === 0)("reads every Outlook demo mail and restores its preset", () => {
  for (const file of files) {
    const expected = findSampleVoyage(file.replace(/\.msg$/i, ""));
    expect(expected, file).toBeDefined();
    const mail = readMsgFile(readFileSync(join(directory, file)));
    expect(mail.subject).not.toBe("");
    const parsed = parseNominationMail(mail.body);
    expect(parsed.unresolved, file).toEqual([]);
    expect(parsed.voyage.voyageNo).toBe(expected!.voyage.voyageNo);
    expect(parsed.voyage.calls).toEqual(expected!.voyage.calls);
    expect(parsed.voyage.constants).toEqual(expected!.voyage.constants);
    expect(parsed.voyage.parcels.map(equivalent)).toEqual(expected!.voyage.parcels.map(equivalent));
  }
});

it("rejects invalid binary input", () => {
  expect(() => readMsgFile(new Uint8Array([1, 2, 3]))).toThrow("不是有效的 Outlook .msg 文件");
  expect(() => readMsgFile(new ArrayBuffer(0))).toThrow("不是有效的 Outlook .msg 文件");
});

it("reports RTF-only mail separately and defaults absent text fields", async () => {
  vi.resetModules();
  const getFileData = vi.fn().mockReturnValue({ dataType: "msg", compressedRtf: new Uint8Array([1]) });
  vi.doMock("@kenjiuno/msgreader", () => ({ default: { default: class { getFileData = getFileData; } } }));
  try {
    const { readMsgFile: read } = await import("./msg-import");
    expect(() => read(new ArrayBuffer(0))).toThrow("邮件正文为 RTF/HTML,请在 Outlook 中另存为纯文本或直接粘贴正文");
    getFileData.mockReturnValue({ dataType: "msg" });
    expect(read(new ArrayBuffer(0))).toEqual({ subject: "", body: "", senderName: "", senderEmail: "" });
    getFileData.mockReturnValue({ dataType: "msg", senderSmtpAddress: "chartering@oceanchem-demo.test", senderEmail: "fallback@oceanchem-demo.test" });
    expect(read(new ArrayBuffer(0)).senderEmail).toBe("chartering@oceanchem-demo.test");
    getFileData.mockReturnValue({ dataType: "msg", senderEmail: "fallback@oceanchem-demo.test" });
    expect(read(new ArrayBuffer(0)).senderEmail).toBe("fallback@oceanchem-demo.test");
    getFileData.mockReturnValue({ dataType: "attachment" });
    expect(() => read(new ArrayBuffer(0))).toThrow("不是有效的 Outlook .msg 文件");
  } finally {
    vi.doUnmock("@kenjiuno/msgreader");
    vi.resetModules();
  }
});
