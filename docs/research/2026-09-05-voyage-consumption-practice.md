# 航程、油水消耗与载重线季节区对配载的影响 · 调研纪要(2026-09-05)

目的:预配载引擎目前把燃油、淡水、常数当作全航次不变的固定重量,到港状态只反映货物增减。实际上大副做「装到到港吃水」时,航程油水消耗、淡水产耗、加油港、载重线季节区、加温锅炉耗油都会改变各港到港/离港的排水量、纵倾与稳性,并直接决定受限港的最大可装量。本纪要归纳专业做法与量级,作为 spec 的依据。

## 1. 大副「装到到港吃水」的标准算法

到港受限港(河口淡水港、浅水泊位)的最大装货量 = 在受限港允许排水量的基础上,**加回从装港离港到该港到港之间消耗的燃油、淡水、滑油**,再扣除途中加装的油水:

```
允许到港排水量(按港口限吃水、港口水密度查静水力)
+ 途中消耗(ME + AE + 锅炉燃油,淡水净消耗)
− 途中加油、加水
− 轻船 − 常数 − 离港时油水 ROB
= 可装货物量
```

要点(来源 [1][2][7]):
- 轮机长提供离港到到港(含引航/机动)的最佳消耗估计,并保留 sea margin;
- 淡水多数船「产多少用多少」,但港内不造水,长途靠泊前要看 FW ROB;
- 港口水密度差用 FWA / DWA 处理(引擎已按港口 ρ 计算);
- 载重线在**航次任一时刻、任一区**都不得没入,进入更严格的区时吃水必须已满足该区限值,可利用进入该区前的油水消耗把装港离港吃水放宽 [3][4]。

## 2. 油水消耗量级(MR 型油化船,演示取值)

| 项目 | 行业量级 | 演示默认值 |
|---|---|---|
| 主机 满载 13 kn | 高效 MR 船 < 19.5 t/d [5];常规 MR 22–26 t/d | 22 t/d |
| 主机 压载 12.5–13 kn | 17.5 t/d [5] | 19 t/d |
| 辅机 海上 | 2–4 t/d [6] | 3 t/d |
| 辅机 港内(无货操) | — | 4 t/d |
| 货操期间(液压泵动力包 + 惰气/锅炉) | 油轮卸货期间港内耗油可显著升高 [6] | 卸货 +6 t/d,装货 +2 t/d |
| 货物加温锅炉 | Aframax 50 °C 原油 3.4–7.9 t/d [8];MR 少量热货 2–4 t/d | 0.5 t/d 每 1 000 t 受热货(海上、港内均计) |
| 淡水消耗 | 船员 20–25 人,约 3–5 t/d | 4 t/d |
| 造水机 海上 | 15–25 t/d,沿岸/港内停用 | 15 t/d(海上),港内 0 |
| Sea margin(天气余量) | 5–10 % [9] | 8 %(航时) |
| 燃油安全余量 | SMS 常规 3–5 天消耗 [10] | 3 天 |
| 货操速率(估港时) | MR 货泵 300–600 t/h 单泵,多票并行受码头限制 | 500 t/h,另加固定 6 h |

演示船油水舱(合成数据 tanks.json):HFO1 P/S 782 m³×2、HFO2 P/S 287 m³×2、DO P/S 207 m³×2、FW P/S 229 m³×2;燃油总容量 ≈ 2 000 t(ρ 0.98,98 %),淡水 ≈ 450 t。

## 3. 消耗对船舶状态的影响

- **排水量与吃水**:远东→欧洲 34 天 ≈ 800–900 t 燃油,平均吃水降低约 0.2 m(TPC≈40 t/cm);这正是受限卸港可多装的量。
- **纵倾**:燃油舱、淡水舱在机舱区(艉部),消耗后艉部减重 → 首倾趋势;长航程到港纵倾与离港可差 0.3–0.5 m。压载调平应按到港状态复核。
- **稳性**:油水是低位重量,消耗后 KG 上升、GM 减小;油舱变为 slack 又增加自由液面。到港 GM 需单独校核(引擎现只按离港状态)。
- **强度**:油水消耗对剪力弯矩影响小于货物/压载,但艉部油水减少会略增中拱;沿用离港强度作近似(引擎已如此)。
- **淡水**:港内不造水,长时间靠泊(多泊位卸货)前 FW ROB 要留够;不足需在港加水,加水又增加到港后的重量。

## 4. 载重线季节区(International Load Line Convention)

- 各线间距:W、T 相对 S 各 1/48 夏季吃水;WNA 再低 50 mm(L ≤ 100 m 才适用);F/TF 为淡水允许量 [3]。
- 与本演示航线相关的季节期 [11]:
  - 北大西洋冬季季节区 II(北海、英吉利海峡、波罗的海入口):**冬季 11-01 至 03-31**;
  - 北太平洋冬季季节区(日本、朝鲜半岛沿岸,约 35°N 以北):**冬季 10-16 至 04-15**;
  - 地中海季节区:冬季 12-01 至 02-28/29;
  - 阿拉伯海季节热带区:热带 09-01 至 05-31;孟加拉湾:热带 12-01 至 04-30;中国海季节热带区(南海):热带 01-21 至 04-30;
  - 上海/宁波、新加坡—苏伊士主航线多为夏季区/热带区。
- 实务:判定航线穿越的**最严区**及其进入点,离港吃水 = 该区限值 + 进入前消耗;本演示简化为每个停靠点指定所处季节区,按到港/离港各自校核。

## 5. 其他应纳入或明确排除的因素

| 因素 | 处理 |
|---|---|
| 港口水密度 / FWA | 已有(按港 ρ 计算浮态) |
| 压载舱位置与纵倾窗口 | 已有(§10 规则) |
| 航速与到港时间(ETA/ETD) | 纳入:按距离/航速 × (1+sea margin) 推算,港时按货操速率估或手填 |
| 加油港 / 加水港 | 纳入:停靠点可填加油、加水吨数 |
| 货物加温耗油 | 纳入:受热货吨数 × 单位耗率 |
| 货物温度变化引起的密度/体积变化(IBC 15.15 装载限制)| 排除:装载率上限已由 HH/H 限值管理;热货体积膨胀留待装载计算侧 |
| 洗舱水、预洗 slop 存留(MARPOL Annex II)| 排除(演示船 SLOP 舱作货舱使用);纪要备注 |
| 富余水深 UKC、潮汐窗口、下蹲 | 排除:港口限吃水视为已含港方 UKC 政策 |
| 压载水置换(D-1)| 排除 |
| 重天气压载 | 排除 |

## 来源

1. Maritime Professionals · Restricted draft at discharge port:https://maritime-professionals.com/restricted-draft-at-discharge-port/
2. MaritimeCalc · FWA & DWA:https://maritimecalc.com/fwa-dwa-calculator/
3. Knowledge of Sea · Loadline and draft marks:https://knowledgeofsea.com/loadline-and-draft-marks/
4. Master Workstation · Load line zones:https://www.master-workstation.com/post/load-line-zones-plimsoll-mark
5. Riviera · An energy-efficient MR tanker optimised for IMO II trades(压载 12.5 kn 17.5 t/d,满载 13 kn < 19.5 t/d):https://www.rivieramm.com/opinion/opinion/an-energy-efficient-mr-tanker-optimised-for-imo-ii-trades-36630
6. Engineer Fix · How much fuel does a tanker ship use:https://engineerfix.com/how-much-fuel-does-a-tanker-ship-use/
7. Marinerspoint · Bunkering operations & bunker plan:https://marinerspointpro.com/what-is-bunkering-operations-procedures-precautions-checklist/
8. Motorship / BWES · Saving fuel through cargo heating management:https://bwesglobal.com/media_coverage/Motorship29042015.pdf
9. HandyBulk · Voyage estimation time at sea(sea margin 5–10 %):https://www.handybulk.com/voyage-estimation-time-at-sea-distance-speed-bunker-consumption-weather-allowance-and-tce/
10. Merchant Navy Decoded · Bunkering guide(safe margin 3–5 天):https://www.merchantnavydecoded.com/bunkering-complete-guide/
11. AtoBviaC · Loadline zones(季节期):https://atobviac.com/helpFiles/WebService/loadline_zones.htm
12. IMO IBC Code Ch.15 filling limits(imorules):https://www.imorules.com/GUID-977275BE-5C8B-4659-9B26-5DDEEC2AE783.html
