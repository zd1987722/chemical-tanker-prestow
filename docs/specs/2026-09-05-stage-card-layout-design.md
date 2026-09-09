# 预配载 · 港序时间线站卡重排 设计(2026-09-05)

> 状态:待实施。起因:加入航程消耗后站卡文字挤成两段长句,用户反馈「不太好看,文字好挤」。

## 0. 原则

- 站卡只放**决策所需**:到港/离港吃水、限值与裕量、ETA/ETD、油水 ROB、结论徽标。航段距离/航时/油耗/港时/加油等**过程量移到选中站的指标面板**(`PlanDetail` 的 `.stow-stage-metrics`)。
- 数字用表格对齐,不用长句;标签与数值分色;块与块之间用细线分隔。
- 卡片宽一点、字号不再缩小:最小 250 px,正文 12 px,行高 1.45;数字 `font-variant-numeric: tabular-nums` + `var(--font-mono)`。

## 1. 站卡结构(`StageTimeline.tsx`)

```
┌──────────────────────────────────────────┐
│ 2  丽水 · 化学品码头 2                 装 │  .stage-t(不变,泊位改为次级色)
├──────────────────────────────────────────┤
│         艏      艉     纵倾              │  .stage-drafts(grid 4 列:label 32px, 1fr×3)
│ 到港   6.70   6.95     —                 │   首港无到港行
│ 离港   6.81   7.31    0.50               │
│ 限 13.00 结构 · ρ 1.025 · 裕量 5.69      │  .stage-limit(一行三个键值,裕量按状态着色)
├──────────────────────────────────────────┤
│ ETA D+1.2 · 11-02      ETD D+2.3 · 11-03 │  .stage-eta(两列)
│ 燃油 1,181 → 1,175   淡水 254 → 250     │  .stage-rob(两列,箭头为到港→离港;有加油时值后加 ⁺500 上标样式的小字)
├──────────────────────────────────────────┤
│ [冬季载重线 12.73] [稳性] [强度] [压载 3275 t] │  .stage-badges(不变)
│ [到港燃油 ROB 低于安全余量 …]            │  告警徽标另起一行(不变)
└──────────────────────────────────────────┘
```

细则:
- `.stage-drafts`:`display:grid; grid-template-columns: 32px repeat(3, 1fr); column-gap: 8px; row-gap: 2px;` 表头行(艏/艉/纵倾)11 px `var(--ink-3)`;数据 12 px mono;行标签(到港/离港)11 px `var(--ink-3)`。纵倾只在离港行显示,到港行填 `—`。
- `.stage-limit`:11.5 px,`span.kv` 结构 `<span class="kv"><i>限</i>13.00<small>结构</small></span>`;`i` 为标签(`var(--ink-3)`,非斜体),`small` 为限值来源(结构 / 冬季 / 热带 / 港口不写);裕量 kv 加 `.warn`(≤ 0.05 且为受限站)或 `.fail`(< −0.01)着色,与徽标一致。
- `.stage-eta`、`.stage-rob`:`display:grid; grid-template-columns: 1fr 1fr; gap: 4px 10px;` 同样 kv 结构:`<span class="kv"><i>ETA</i>D+1.2<small>11-02</small></span>`;ROB:`<span class="kv"><i>燃油</i>1,181 → 1,175</span>`,加油/加水时在离港值后追加 `<b class="stage-take">+500</b>`(`var(--ok)` 色 10.5 px)。
- 无 `consumables` 时省略 eta/rob 两行及其分隔线(向后兼容)。
- 压载态规则行(`dm 6.55 ≥ 5.5 · 纵倾 1.0/≤2.5`)保留,放在 `.stage-limit` 之后同样式,改为 kv 结构:`<span class="kv"><i>dm</i>6.55<small>≥ 5.5</small></span><span class="kv"><i>纵倾</i>1.0<small>≤ 2.5</small></span>`。
- 分隔线:`.stage > .stage-sep { border-top: 1px solid var(--border); }`(用空 `<i class="stage-sep" aria-hidden>` 元素),放在 drafts 块前、eta 块前、badges 前。
- 卡片:`min-width: 250px; flex-basis: 250px; max-width: 360px; padding: 12px 14px; gap: 8px;`;窄屏(≤ 1599 px 现有覆盖)`min-width: 230px`。`.stage-all` 不变。
- `.stage-t` 泊位部分改为 `<strong>丽水</strong><span class="stage-berth">化学品码头 2</span>`,泊位 `var(--ink-3)` 12 px,溢出省略。

## 2. 选中站指标面板(`PlanDetail.tsx` 的 `.stow-stage-metrics`)

现有 `.stow-stage-metrics` 在「本站精算明细」`<details>` 里。新增一个独立的 `KvList`(同样 `stow-stage-metrics` 样式,标题「本站航程」,放在选中站区块中、精算明细之前,不依赖精算),项目(有 `consumables` 时):`航段` `170 nm · 0.6 d`;`油耗(航段)` `15 t`;`港内` `26 h · 油耗 5 t`;`加油 / 加水` `+500 / —`;`到港 ROB` `燃油 1,181 · 淡水 254`;`离港 ROB` `燃油 1,175 · 淡水 250`;`安全余量` `75 t(3 d)`;`ETA / ETD` `D+1.2(11-02)/ D+2.3(11-03)`。沿用现有 dl 样式;若面板目前按分组渲染,则新加分组标题「航程」。

## 3. 验收

- Playwright 1440 宽度下 far-east-europe-12 首方案时间线截图:每张卡不超过 8 行文字,无换行断句,数字列对齐。
- 现有 vitest、typecheck 全绿;不改引擎与数据。
