import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SAMPLE_VOYAGES } from "../client/src/lib/prestow/sample-voyages";
import { formatNominationMail } from "../client/src/lib/prestow/mail-format";

const args = process.argv.slice(2);
const index = args.indexOf("--out");
if (index >= 0 && !args[index + 1]) throw new Error("--out requires a directory");
const outDir = resolve(index < 0 ? ".tmp/demo-mails" : args[index + 1]);
await mkdir(outDir, { recursive: true });
const meta = { to: "operations@tankersafe-demo.test", from: "远航化学品船务(演示)· 租船操作" };
const manifest = [];
for (const entry of SAMPLE_VOYAGES) {
  const { subject, body } = formatNominationMail(entry.voyage, meta);
  await writeFile(resolve(outDir, `${entry.id}.subject.txt`), subject, "utf8");
  await writeFile(resolve(outDir, `${entry.id}.body.txt`), body, "utf8");
  manifest.push({ id: entry.id, voyageNo: entry.voyage.voyageNo, title: entry.title, subject, ...meta, fromEmail: "chartering@oceanchem-demo.test" });
}
await writeFile(resolve(outDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
console.log(`Generated ${manifest.length} demo mails (subject/body text and manifest) in ${outDir}`);
