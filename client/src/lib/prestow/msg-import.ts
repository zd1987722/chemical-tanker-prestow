import MsgReader from "@kenjiuno/msgreader";

export interface ImportedMail { subject: string; body: string; senderName: string; senderEmail: string; fileName?: string }

export function readMsgFile(data: ArrayBuffer | Uint8Array): ImportedMail {
  const Ctor = (MsgReader as unknown as { default?: typeof MsgReader }).default ?? MsgReader;
  let fields: ReturnType<MsgReader["getFileData"]>;
  try {
    fields = new Ctor(new Uint8Array(data).buffer).getFileData();
    if (fields.dataType !== "msg") throw new Error();
  } catch {
    throw new Error("不是有效的 Outlook .msg 文件");
  }
  if (!fields.body && fields.compressedRtf) {
    throw new Error("邮件正文为 RTF/HTML,请在 Outlook 中另存为纯文本或直接粘贴正文");
  }
  return { subject: fields.subject ?? "", body: fields.body ?? "", senderName: fields.senderName ?? "", senderEmail: fields.senderSmtpAddress ?? fields.senderEmail ?? "" };
}
