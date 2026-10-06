# 预配载 · 租家邮件(.msg)导入与规则解析 设计(2026-09-05)

> 状态:已实施(2026-09-05)。

## 0. 目标

1. 每个预设航次(`SAMPLE_VOYAGES`,6 个)各配一封演示邮件,Outlook `.msg` 格式,放在 `client/public/demo-mails/`,页面上可下载。
2. 系统能导入 `.msg` 文件,读出主题与纯文本正文,并**在浏览器内按规则解析**为航次草稿(港序、泊位、吃水限制、水密度、货票、数量意向、密度、加温),走现有「确认覆盖当前航次」流程。
3. 邮件正文由代码从航次数据**生成**(`formatNominationMail`),解析器 `parseNominationMail` 与之构成往返:对 6 个预设航次,`parse(format(v))` 必须还原出等价航次(测试保证)。

不做:RTF/HTML 正文解码、附件解析、`.eml`、服务器端 `.msg` 处理。全部为虚构船与演示港口数据,邮件署名用虚构公司名,不得出现真实企业商标。

## 1. 文件与职责

| 文件 | 职责 |
|---|---|
| `client/src/lib/prestow/product-catalog.ts`(新) | 演示货品目录 + 别名;`resolveCatalogProduct(text)` |
| `client/src/lib/prestow/sample-voyages.ts`(改) | `PRODUCTS` 改为从目录取;其余不变 |
| `client/src/lib/prestow/mail-format.ts`(新) | `formatNominationMail(voyage, meta?) → { subject, body }` |
| `client/src/lib/prestow/mail-parse.ts`(新) | `parseNominationMail(text) → { voyage, unresolved }` |
| `client/src/lib/prestow/msg-import.ts`(新) | `readMsgFile(data: ArrayBuffer | Uint8Array) → { subject, body, senderName }`(`@kenjiuno/msgreader`,已安装 ^1.28.0) |
| `client/src/lib/prestow/mail-format.test.ts`(新) | 往返测试(6 预设)+ 解析边界 |
| `client/src/lib/prestow/msg-import.test.ts`(新) | 读取 `client/public/demo-mails/*.msg` 再解析 = 预设航次;目录不存在时 `it.skipIf` |
| `client/src/components/prestow/ScenarioPanel.tsx`(改) | 导入 `.msg`、规则解析、演示邮件下载列表;AI 解析保留 |
| `client/src/components/prestow/StowTitleBar.tsx`(改) | 标题条加「导入邮件(.msg)」按钮(与「示例航次」并列) |
| `client/src/pages/Prestow.tsx`(改) | 把标题条选中的文件传给 `ScenarioPanel` |
| `client/src/index.css`(改) | `.stow-mail-*` 样式 |
| `scripts/gen-demo-mails.mts`(新) | 用 `formatNominationMail` 为 6 个预设写出 `<outDir>/<id>.subject.txt`、`<id>.body.txt`、`manifest.json` |

`package.json` scripts 增加 `"gen:demo-mails": "tsx scripts/gen-demo-mails.mts"`。

## 2. 货品目录 `product-catalog.ts`

```ts
export interface CatalogProduct {
  key: ProductKey;            // 与 sample-voyages 现有 ProductKey 相同 + "phenol" | "acn"
  name: string;               // 英文正名,如 "METHANOL"
  display: string;            // 默认显示名,如 "甲醇 Methanol"
  group: number;              // USCG 族
  density: number;
  boilPointC: number; meltPointC: number; polymerizable: boolean;
  aliases: string[];          // 中英文别名,匹配时忽略大小写、空格与标点
}
export const PRODUCT_CATALOG: CatalogProduct[];
export function resolveCatalogProduct(text: string): { product: CatalogProduct; score: number } | null;
```

- 目录内容 = `sample-voyages.ts` 现有 17 项 PRODUCTS 原值,加 `phenol`(PHENOL / 苯酚(熔融)Phenol / 21 / 1.05 / 181.7 / 40.9 / false)与 `acn`(ACRYLONITRILE / 丙烯腈 Acrylonitrile / 15 / 0.81 / 77.3 / −83.5 / true),数值照抄 `sample-voyage.ts`。
- 别名至少含:中文名、英文名、常用缩写。示例:meoh `["甲醇","methanol","meoh"]`;meg `["乙二醇","ethylene glycol","meg","mono ethylene glycol"]`;naoh `["烧碱","caustic soda","sodium hydroxide","naoh"]`;etac `["乙酸乙酯","ethyl acetate","etac"]`;buac `["乙酸丁酯","butyl acetate","buac"]`;hexane `["正己烷","n-hexane","hexane"]`;cyclohexane `["环己烷","cyclohexane"]`;benzene `["苯","benzene"]`;toluene `["甲苯","toluene"]`;xylene `["二甲苯","xylene","xylenes"]`;phenol `["苯酚","phenol"]`;styrene `["苯乙烯","styrene","sm"]`;mek `["甲基乙基酮","丁酮","mek","methyl ethyl ketone"]`;其余类推。
- 匹配算法:`normalize(s) = s.toLowerCase().replace(/[\s\-_·,.()（）/]/g, "")`;对每个产品取「被 normalize(text) 包含的最长别名」的长度作 score,取最高者;最高分并列 → 返回 null(交由调用方记 unresolved)。必须满足:`苯 Benzene(南京卸)`→benzene,`甲苯 Toluene`→toluene,`苯酚(熔融)Phenol`→phenol,`混合二甲苯 Xylene`→xylene,`正己烷 n-Hexane(上海装 · 单舱)`→hexane,`环己烷 Cyclohexane`→cyclohexane,`烧碱溶液 50%`→naoh,`MTBE`→mtbe,`乙二醇 MEG(鹿特丹)`→meg。
- `sample-voyages.ts` 的 `PRODUCTS` 改为由目录派生(`Object.fromEntries(PRODUCT_CATALOG.map(...))`),导出值与现在逐字段相同,现有测试与 CSV 快照不得变化。

## 3. 邮件正文格式(生成器 `mail-format.ts`)

```ts
export interface MailMeta { from?: string; to?: string }
export function formatNominationMail(voyage: StowVoyage, meta?: MailMeta): { subject: string; body: string };
```

主题:`配载申请 / ${voyageNo} / ${装港去重顺序.join("-")} → ${卸港去重顺序.join("-")}`。装港 = 有货票以其为装港的停靠点;卸港 = 有货票以其为卸港的停靠点;既无装也无卸的停靠点归入「其他停靠」段(见下)。

正文(行尾 `\r\n`,严格按此布局,便于解析;`N.` 为全航次连续序号):

```
操作部各位:

请为下述航次准备预配载方案(货舱分配、逐港到港/离港吃水、稳性与强度校核),回复时请注明受限港。

航次号: DEMO-2026-05
船舶: 虚构船 · MR 型油化船(演示数据)

装港顺序:
1. 蔚山 / 3 号泊位
2. 蔚山 / 7 号泊位
3. 丽水 / 化学品码头 2

卸港顺序:
6. 安特卫普 / K1 · 最大吃水 12.5 m · 海水 1.025
7. 鹿特丹 / Botlek · 最大吃水 11.8 m · 淡水 1.000
8. 汉堡 / Blumensand · 最大吃水 11.5 m · 淡水 1.000

货票:
1. 甲醇 Methanol · 4,660 MT · 密度 0.790 · 蔚山 3 号泊位 → 鹿特丹 Botlek
2. 苯酚(熔融)Phenol · 5,000 MT · 密度 1.050 · 蔚山 7 号泊位 → 安特卫普 K4 · 加温 50 °C
3. 甲醇 Methanol · 尽量多(优先 1) · 密度 0.790 · 蔚山 3 号泊位 → 张家港 长江国际化工码头
4. 烧碱溶液 50% · 4,000–8,000 MT(区间) · 密度 1.520 · 蔚山 7 号泊位 → 安特卫普 K1
5. 乙二醇 MEG · 比例 2 · 密度 1.110 · 蔚山 3 号泊位 → 鹿特丹 Botlek

备注:
- 以上船舶、港口吃水限制与水密度均为演示值,不代表实际公告。
- 货票名称后括号内为分票备注,请按票分别核算舱位与到港吃水。

顺祝商祺
${meta.from ?? "远航化学品船务(演示)· 租船操作"}
```

规则:
- 泊位为空时港口行只写 `N. 港口`(无 ` / `)。
- 吃水段:`maxDraftM` 有值才写 `· 最大吃水 X m`(保留 1 位小数,`12.5`、`10.5`)。
- 水密度段:`waterDensity` 有值才写;1.025 → `海水 1.025`,1.000 → `淡水 1.000`,1.015 → `咸淡水 1.015`,其他 → `水密度 1.005`(3 位小数)。
- 「其他停靠」段:既不装也不卸的停靠点(预设里没有,保留能力),标题 `其他停靠:`。
- 货票数量:`fixed` → `4,660 MT`(千分位逗号,普通空格,不用 U+202F);`priority` → `尽量多(优先 N)`;`range` → `4,000–8,000 MT(区间)`(en dash);`ratio` → `比例 N`。`intake` 缺省视为 fixed。
- 密度 `toFixed(3)`;加温仅 `heating.enabled` 时写 `· 加温 ${carriageTempC} °C`。
- 货票名 = `parcel.display` 原样(含「(蔚山装)」等备注)。
- 装/卸港写 `${port} ${berth}`,泊位空则只写港口。

## 4. 规则解析 `mail-parse.ts`

```ts
export interface ParsedMail { voyage: StowVoyage; unresolved: string[]; matched: { calls: number; parcels: number } }
export function parseNominationMail(text: string): ParsedMail;
```

- 行预处理:统一 `\r\n`/`\n`;全角冒号 `:` 视同 `:`;`->`、`→`、`至` 都算箭头;数字去掉 `,`、U+202F、空格;`t`/`吨`/`MT`/`mt` 都算吨。
- 段落识别(整行,允许冒号后有空白):`装港顺序|装港|Loading rotation|Load ports`→load;`卸港顺序|卸港|Discharging rotation|Discharge ports`→discharge;`其他停靠|Other calls`→unknown;`货票|货物|Cargo parcels|Cargoes`→parcels;`备注|Remarks` 及其后忽略。段外行忽略,但 `航次号: X`(或 `Voyage: X`)任何位置都取。`主题:`/`Subject:` 行忽略(UI 会把主题拼进文本)。
- 港口行:`^\s*\d+[.)]\s*(?<port>[^/·]+?)(?:\s*/\s*(?<berth>[^·]+?))?(?:\s*·\s*(?<rest>.*))?$`;`rest` 里找 `最大吃水\s*([\d.]+)`、`(海水|淡水|咸淡水|SW|FW|BW)\s*([\d.]+)?`、`水密度\s*([\d.]+)`。关键词无数字时 海水/SW=1.025、淡水/FW=1.000、咸淡水/BW=1.015。停靠点 id:装港 `L1..`、卸港 `D1..`、其他 `C1..`;`seq` 按全文出现顺序 0..n−1。
- 货票行:以 ` · ` 切分(也接受 `;`):第 1 段名称,第 2 段数量意向,其余段按内容识别(`密度 x`、`装 → 卸`、`加温 N °C`),顺序不限。数量意向:`([\d.]+)\s*(MT|t|吨)` → fixed;`尽量多|最大|max` → priority(括号内 `优先 N`,缺省按出现顺序编号);`([\d.]+)\s*[–-~]\s*([\d.]+)` → range(minMt/maxMt,quantityMt 0);`比例\s*([\d.]+)|ratio` → ratio(quantityMt 0)。
- 货票 → `Parcel`:`resolveCatalogProduct(名称)`:命中 → `name/group/boilPointC/meltPointC/polymerizable` 取目录,`display` = 名称原文,`density` = 行内密度,缺则目录密度;未命中 → `name` = 名称原文,`display` 同,`group: null`,`boilPointC/meltPointC: null`,`polymerizable: false`,`density` = 行内密度或 0,并记 `未识别货品:X,请手工指定 USCG 族与密度`。`productId: null`,`maxAllowedTempC: null`,`heating` 按加温段。`id` = `P1..`。
- 装/卸港匹配:在对应类型(load / discharge,找不到再看 unknown)的停靠点里,取 `normalize(port + berth)` 被 `normalize(段文本)` 包含且最长者;无 → `loadCallId: ""` 并记 `装港无法匹配停靠点:X(货名)`(卸港同理)。
- 段内不匹配任何行式的非空行 → `无法解析行:<原文前 60 字>`。
- `voyage.shipId = ""`(调用方补 `DEMO_STOW_SHIP.id`),`constants` 不输出。
- 输出前 unresolved 去重(现有 server 的 `addUnresolved` 语义)。

## 5. `.msg` 读取 `msg-import.ts`

```ts
export interface ImportedMail { subject: string; body: string; senderName: string; fileName?: string }
export function readMsgFile(data: ArrayBuffer | Uint8Array): ImportedMail;
```

- `import MsgReader from "@kenjiuno/msgreader"`;包为 CJS,若默认导入在 vite 下不是构造函数,用 `const Ctor = (MsgReader as any).default ?? MsgReader`。`new Ctor(new Uint8Array(data)).getFileData()` → `subject`、`body`、`senderName`(可能为空串)。
- `body` 为空但 `compressedRtf` 存在 → 抛 `Error("邮件正文为 RTF/HTML,请在 Outlook 中另存为纯文本或直接粘贴正文")`。`getFileData()` 抛错或 `dataType !== "msg"` → 抛 `Error("不是有效的 Outlook .msg 文件")`。
- UI 组合文本:`主题: ${subject}\n\n${body}`;`senderName` 非空时在主题下加 `发件人: ${senderName}`。

## 6. UI

### 6.1 `ScenarioPanel`
- summary 改为「导入租家邮件 / 粘贴 scenario」,副文「.msg 或文字,规则解析或 AI 解析为航次草稿,确认后才覆盖」。
- 新增 props:`incomingFile?: File | null; onFileConsumed?(): void`。收到新 `File` 时:`<details>` 打开(受控 `open` state),读文件 → `readMsgFile` → 填 textarea → 立即规则解析 → 显示确认块;读取失败显示 `stow-result-danger` 横幅。
- 操作行:`导入 .msg 邮件`(隐藏 `<input type="file" accept=".msg">`)、`规则解析`(主按钮,文本非空可用)、`AI 解析`(现有,仅 available!==false)、`载入示例邮件`(现有)、字数。
- 规则解析结果 0 停靠点或 0 货票时:横幅 `stow-result-warning`「未识别为标准配载申请格式;可改用 AI 解析或手工录入」。
- 元信息行 `.stow-mail-meta`:`已读取 <文件名> · 主题 … · 正文 N 字`。
- 演示邮件下载列表 `.stow-mail-links`:标题「演示邮件(.msg)」,6 个 `<a href="/demo-mails/<id>.msg" download="配载申请-<voyageNo>.msg">` 用 `SAMPLE_VOYAGES` 的 title;提示「下载后用上方按钮导入,或在 Outlook 中打开查看」。
- 确认块与未解析列表沿用,`onApply(voyage, unresolved)` 不变。

### 6.2 `StowTitleBar` / `Prestow`
- 标题条 actions 里「示例航次」之后加 `MButton variant="ghost" icon={Mail}` 「导入邮件(.msg)」,内部隐藏 file input;选中后 `onImportMail(file)`。
- `Prestow.tsx`:`const [incomingFile, setIncomingFile] = useState<File|null>(null)`;传给 `ScenarioPanel`,`onFileConsumed` 置回 null。导入后页面滚到 ScenarioPanel(`scrollIntoView({behavior:"smooth", block:"start"})`)。

### 6.3 CSS
在 `.stow-scenario-*` 附近加:`.stow-mail-meta`(次级小字,`var(--ink-3)`),`.stow-mail-links`(`ul` 无点,链接一行一个,`font-size: 13px`),响应式与现有一致。窄屏标题条已有 `.stow-sample-field { width:100% }` 规则,新按钮沿用现有 `stow-titlebar-actions` 布局,不新增布局规则。

## 7. 生成脚本

`scripts/gen-demo-mails.mts`(tsx 运行,参数 `--out <dir>`,缺省 `.tmp/demo-mails`):对 `SAMPLE_VOYAGES` 每项写 `<id>.subject.txt`、`<id>.body.txt`(UTF-8,无 BOM)与 `manifest.json`:`[{ id, voyageNo, title, subject, to: "operations@tankersafe-demo.test", from: "远航化学品船务(演示)· 租船操作", fromEmail: "chartering@oceanchem-demo.test" }]`。

`scripts/gen-demo-mails.ps1`(Windows PowerShell 5.1,由 Claude 运行):参数 `-InDir`(缺省 `.tmp\demo-mails`)、`-OutDir`(缺省 `client\public\demo-mails`)。读 manifest,对每项:

```powershell
$ol = New-Object -ComObject Outlook.Application
$m = $ol.CreateItem(0)
$m.Subject = [IO.File]::ReadAllText("$InDir\$id.subject.txt", [Text.Encoding]::UTF8)
$m.BodyFormat = 1   # 纯文本
$m.Body = [IO.File]::ReadAllText("$InDir\$id.body.txt", [Text.Encoding]::UTF8)
$m.To = $entry.to
$pa = $m.PropertyAccessor
$tag = "http://schemas.microsoft.com/mapi/proptag/"
$pa.SetProperty($tag + "0x0C1A001F", $entry.from)        # PR_SENDER_NAME
$pa.SetProperty($tag + "0x0C1F001F", $entry.fromEmail)   # PR_SENDER_EMAIL_ADDRESS
$pa.SetProperty($tag + "0x5D01001F", $entry.fromEmail)   # PidTagSenderSmtpAddress
$pa.SetProperty($tag + "0x0042001F", $entry.from)        # PR_SENT_REPRESENTING_NAME
$pa.SetProperty($tag + "0x0065001F", $entry.fromEmail)   # PR_SENT_REPRESENTING_EMAIL_ADDRESS
$pa.SetProperty($tag + "0x0E070003", 1)                  # PR_MESSAGE_FLAGS = MSGFLAG_READ(去掉 UNSENT,Outlook 不再显示为草稿)
$pa.SetProperty($tag + "0x00390040", [DateTime]::UtcNow) # PR_CLIENT_SUBMIT_TIME
$m.SaveAs("$OutDir\$id.msg", 9)   # 9 = olMSGUnicode,必须用 9;3(ANSI)会把中文存成本地代码页
```

字符串一律从 UTF-8 文件读,不要把中文写进 .ps1 参数(控制台代码页会乱码)。

**生成后必须运行 `python scripts/scrub-demo-mails.py`**:Outlook 会把本机登录账号写进 PR_LAST_MODIFIER_NAME(0x3FFA001F),PropertyAccessor 不允许覆盖;脚本用 olefile 原地改写为虚构名(同字节长度)。2026-09-05 曾因此把个人邮箱带进公开仓与线上,教训。

## 8. 测试

- `mail-format.test.ts`:
  1. 对 `SAMPLE_VOYAGES` 每项:`parseNominationMail(formatNominationMail(v).body)`,去掉 parcel `id` 后 `calls` 深等于原 `calls`(id/seq/port/berth/maxDraftM/waterDensity 完全一致),`parcels` 逐票深等于原票(除 `id`;`intake` 缺省与 `{mode:"fixed"}` 视为等价——生成器对无 `intake` 的票写 fixed,解析器对 fixed 不输出 `intake` 字段,以匹配预设数据),`unresolved` 为空,`voyageNo` 一致。
  2. 主题:`far-east-europe-12` → `配载申请 / DEMO-2026-05 / 蔚山-丽水-大山-宁波 → 安特卫普-鹿特丹-汉堡`。
  3. 未知货品行 → `group: null` + unresolved 含「未识别货品」。
  4. 卸港写错 → `dischargeCallId: ""` + unresolved 含「卸港无法匹配」。
  5. range / ratio 行解析出对应 `intake`。
  6. 无段落标题的自由文本 → `matched.calls === 0 && matched.parcels === 0`,不抛错。
- `msg-import.test.ts`:`readdirSync("client/public/demo-mails")` 的每个 `.msg` → `readMsgFile` → `parseNominationMail` → 与 `findSampleVoyage(id)` 比较(同上等价规则);目录缺失或为空时 `it.skipIf`。
- `sample-voyages` 现有测试与快照不变;`pnpm check`、`pnpm vitest run` 全绿。

## 9. 交付顺序

2. Claude:`pnpm gen:demo-mails` → `powershell -File scripts/gen-demo-mails.ps1` → `pnpm vitest run client/src/lib/prestow/msg-import.test.ts` → Playwright 冒烟(导入 → 确认 → 生成方案)→ 提交 → 部署。
