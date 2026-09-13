# 数据目录

这里存放前端可直接加载的结构化数据。卡片 `id` 永久稳定，界面文案可修改，规则与存档始终通过 `id` 关联。

## 文件

- `baishe-cards.json`：白蛇传基础卡片清单（v1，仅 `id` / `name` / `image`）。
- `kongque-cards.json`：孔雀东南飞完整游戏数据（v2），含卡片、规则、关卡、结局与评分参数。内容全部来自《孔雀东南飞传说》故事拼图游戏内容策划书 V1.0，代码中不写任何剧情文字。

## kongque-cards.json 结构

### 顶层字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `gameId` / `gameName` | string | 游戏标识与显示名 |
| `version` | number | 数据版本号，当前为 2 |
| `tagVocabulary` | string[] | 主题标签受控词表，卡片 `tags` 只能取其中的值 |
| `conflictTags` | string[] | 冲突类标签子集，供“冲突节点/冲突角色”类校验使用 |
| `decisionTags` | string[] | 抉择类标签子集，供“抉择节点”类校验使用 |
| `marks` | object[] | 主题印记目录：`{ id, name, setBy }`，`setBy` 为触发该印记的事件 id |
| `flagCatalog` | object[] | 状态标记目录：`{ id, name, setBy }`，供事件前置条件与结局判定使用 |
| `acts` | object[] | 五幕定义：`{ id: 1–5, name, function }` |
| `scenes` / `characters` / `events` | object[] | 三类卡片，见下 |
| `combos` | object[] | 关键组合 → 即时生成文本（策划书表 7、表 8） |
| `softHints` | object[] | 无效组合的柔性错误提示（策划书表 9） |
| `endings` | object[] | 6 个结局及条件，按 `priority` 升序结算 |
| `levels` | object[] | 5 个关卡的完整定义 |
| `scoring` | object | 评分维度、分值、星级、称号与提示规则参数 |

### 卡片公共字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 稳定编号（S01–S12 / C01–C12 / E01–E22），永不修改 |
| `name` | string | 卡片名称 |
| `image` | string | 相对本 JSON 文件的图片路径，如 `../images/kongque/S01.png` |
| `description` | string | 卡面说明（策划书 4.1–4.3 的设定文字） |
| `source` | string | 来源分层：`core` 原作核心 / `legend` 传说表达 / `added` 游戏新增（策划书 2.1） |
| `tags` | string[] | 主题标签，取值限于 `tagVocabulary` |

场景卡额外字段：

- `allowedEvents`：string[]，该场景可发生的事件 id（策划书表 3“适配事件”）。

事件卡额外字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `allowedScenes` | string[] | 可发生该事件的场景 id |
| `requiredCharacters` | string[] | 必须在场的角色 id（每幕角色限 1–3 张） |
| `prerequisites` | object | 前置条件，见下 |
| `effects` | object | 事件生效后产生的状态变化 |

`prerequisites` 结构（策划书 5.1 的 8 条时序约束）：

```jsonc
{
  "events": ["E04"],        // 此前必须全部出现过的事件
  "anyEvents": ["E08","E09"], // 此前至少出现其中一个
  "flags": ["familyConflict"], // 必须已成立的状态
  "forbiddenFlags": ["lanzhiDead"], // 必须未成立的状态
  "anyOf": [ /* 可选：分支式前置，任一分支全部满足即可 */
    { "events": ["E07"] },
    { "flags": ["divorced"] }
  ]
}
```

- 基础键 `events` / `anyEvents` / `flags` 之间为“与”关系。
- `anyOf` 可选，每个分支支持 `events` / `anyEvents` / `flags` / `marks`；任一分支满足即前置成立，用于同一事件的经典线与改写线（如 E08/E09 可由 E07 归家或 E04 遣归触发；E15 可由 E14 合葬或同时持有“拒绝权贵＋乡民相助”印记触发，后者是第 5 关无死亡的孔雀重飞分支）。
- 所有分支均不满足时，提示系统按缺失项最少的分支生成引导文案。

`effects` 结构：

```jsonc
{
  "flags": ["lanzhiDead"],  // 置位的状态（id 见 flagCatalog）
  "marks": ["oath"],        // 获得的主题印记（id 见 marks）
  "deaths": ["C01"]         // 死亡的角色；死亡后再安排日常事件为严重矛盾
}
```

### combos / softHints

- `combos`：`{ scene, characters[], event, text, source }`。玩家某幕的卡片恰好匹配时，右栏即时显示 `text`（原文来自策划书表 7、表 8）。
- `softHints`：`{ id, type, event, badScenes?, maxBadAct?, text }`。
  - `type` 取值：`eventNotInScene`（场景不符）、`missingPrerequisite`（前置缺失）、`missingCharacter`（缺少人物）、`actTooEarly`（结局过早）。
  - 提示按“缺少人物—场景不符—前置缺失—状态冲突”的优先级只给出一条（`scoring.hints.priority`）。

### endings

`{ id, name, priority, hidden, condition, text }`，结算时按 `priority` 从小到大取第一个满足条件者（策划书 9.7 顺序）。

`condition` 各键均为“与”关系，数组内除 `any*` 外均要求全部满足：

| 键 | 含义 |
|---|---|
| `events` / `anyEvents` | 必须出现 / 任一出现的事件 |
| `scenes` / `anyScenes` | 必须使用 / 任一使用的场景 |
| `characters` / `anyCharacters` | 必须在场 / 任一场在场的角色 |
| `marks` | 必须集齐的主题印记 |
| `flags` / `forbiddenFlags` | 必须成立 / 必须未成立的状态 |
| `minScore` / `minCulture` | 总分 / 文化还原度下限 |

结局 id：`hidden` 孔雀重飞（隐藏）、`independence` 兰芝新生、`reconcile` 破礼重圆、`flee` 磐石蒲苇、`classic` 经典悲剧、`wealth` 富贵空梦。

### levels

每关：`{ id, name, acts, passScore, positioning, pool, goals, preset?, tutorial?, recommended?, notes?, routes?, examples?, autoAppend?, bonus?, scoreBonuses?, challenge?, threeStar?, contentWarning?, failHints[], rewards, rerolls?, themes?, endingPriority?, failFeedback? }`。

- `acts`：幕数，第 1 关 3 幕、第 2 关 4 幕、第 3–5 关 5 幕。
- `pool`：`{ scenes[], characters[], events[], lockedEvents[] }`，本关可用与锁定的卡（策划书 9.3–9.7）。
- `goals` 常用键：`allActsValid`、`cooccur`（角色至少同幕一次）、`tags`（必须命中的标签）、`mustIncludeCharacters`、`flow`（阶段名称，仅展示）、`flowStages`（阶段机读定义，见下）、`ordering`（`{ before, after?/afterAny? }` 时序；`after` 可写单个 id 字符串或 id 数组）、`endings`（可触发结局白名单）、`conflictInFirstActs`（对象 `{ acts, min }`，前 `acts` 幕内至少 `min` 个冲突节点）、`minAddedEvents` + `addedEventsAfterAct`、`forbiddenDeaths`、命题限制键（`cooccurMinActs`、`minConflictCharacters`、`finalActLedBy`、`characterArc`、`forbiddenEvents`、`finalScene` 等）。
- `goals.flowStages`：第 2 关四阶段顺序的机读定义，为“每阶段可接受事件 id 组”的数组（与展示用 `flow` 名称一一对应）。各阶段首次命中位置只能不允许后退；允许同一事件同时承载相邻两阶段（如 E04 既是“求情失败”结果也是“遣归辞别”开端）。
- `preset`：教学关预置卡片，如第一幕预置 S02。
- `tutorial`：教学分步引导（第 1 关），每步 `{ text, goal? }`；`text` 为策划书原文，`goal` 为机读完成条件，缺省视为纯说明（展示后即完成）。`goal` 支持键：
  - `act`：要求该幕（1 起）三类齐备；可叠加 `characters`（这些角色必须在该幕）与 `events`（该幕事件必须为列出的 id）。
  - `actsComplete`：齐备幕数下限。
  - `submitted`：要求至少提交过一次编排。
  - 引导进度随关卡草稿存档（`drafts[levelId].tutorialStep / tutorialSubmitted`）。
- `recommended` / `routes` / `examples`：推荐组合、可通关路线与原文示例，供提示与图鉴使用。
- `autoAppend`：满足条件后在结局演出中自动追加的事件（第 3 关 E12 后追加 E13，继而追加 E14、E15）。追加事件不占幕槽，其发生位置按追加顺序记为“最后一幕之后”，供 `goals.ordering` 判定。玩家也可亲手把 E13 摆入第五幕（S10＋C02，策划书表14）：已在编排中发生的事件不会被重复追加，两种摆法都成立，后者更贴近字面流程，前者可在五幕内容纳 E06 誓言意象从而达成三星。
- `scoreBonuses`：关卡专项加分 `{ event, dimension, points }[]`，事件在故事中发生时给指定维度加分（维度分单独封顶）。第 2 关 E22 传递书信 +3 逻辑分（策划书 9.4），第 3 关 E11 仲卿诀别 +3 完整度（策划书 9.5）。
- `threeStar`：三星挑战的结构化条件（策划书 9.2 规则4），缺省键不参与判定；三星须总分 ≥90、无严重逻辑错误且下列条件全部满足：
  - `ordering`：与 `goals.ordering` 同构的因果顺序要求（第 1 关 劳作→求情→誓言）。
  - `tags`：必须全部命中的主题标签（第 2 关 家庭权力/个人尊严/婚姻压力）。
  - `minCulture`：文化还原度下限（第 3 关 15）；`imageryEvents` + `minImagery`：经典意象事件（E06/E11/E15）至少命中数。
  - `forbiddenEvents`：不得使用的事件（第 4 关禁用 E17）；`endings`：结局必须在白名单内。
  - `minDistinctScenes`、`noDuplicateEvents`、`sourceMix`（`{ core, legend, added }` 三类来源事件最低使用数）、`differentEndingFromLast`（须与本关上次最佳结局不同）用于第 5 关。
  - `noLevel3Hint`：使用过三级提示则本项不满足（与全局封二星规则叠加）。
  - 结算面板会列出未满足项（“距三星挑战还差”）。
- `rewards`：`{ cards[], codex[], marks[], other[] }`，通关解锁内容。
- `themes`：仅第 5 关，随机命题 `{ name, tags, 限制键... }`。
  - 限制键：`cooccur` + `cooccurMinActs`（固定组合同台幕数）、`minConflictCharacters`（冲突类角色登场数，见顶层 `conflictTags`）、`finalActLedBy`（终幕主导角色）、`characterArc`（需在两幕形成成长线的角色）、`mustIncludeCharacters`、`marks`（需达成的印记）、`forbiddenEvents`（禁用事件）、`finalScene`（终幕场景）。
  - `recommended`：命题专属的逐幕推荐（结构同关卡级 `recommended`）。三级提示优先取当前命题的推荐，保证任意命题下按提示摆放都能满足命题限制并通关；缺省时回退到关卡级 `recommended`，再回退到 combos 组合表。命题名随草稿存档（`drafts[levelId].theme`），重进关卡沿用同一命题。
  - `rerolls`：进入关卡时随机抽题，允许更换命题的次数。
  - `endingPriority`：覆盖全局结局判定顺序（如第 5 关优先判定隐藏结局）。
  - `goals.minConflictNodes` / `goals.minDecisionNodes`：有效幕中冲突/抉择节点（按 `conflictTags`/`decisionTags` 判定）的最少幕数。

### scoring

策划书 8.1–8.3 与 9.2 的参数化：

- `dimensions`：四维满分 `{ completeness: 30, logic: 30, theme: 25, culture: 15 }`。
- `perValidAct`（4）、`allPhasesBonus`（10）、`prerequisiteMin/Max`（3–5）、`contradictionPenalty`（8）、`coreCharactersBonus`（5）、`imagery`（磐石蒲苇/东南枝/双鸟各 2–4 分）。
- 完整度按“有效幕”计（放齐但逻辑不成立的幕不计）；文化分中三位核心人物各幕登场即可，不要求同场。
- `range` `[0,100]`；`pass` 70；`legend` 90。
- `stars`：一星达通关分；二星 80 分且无严重逻辑错误；三星 90 分、无严重逻辑错误且完成 `threeStar` 结构化挑战。
- `ranks`：五档称号（传说织梦者/故事编织者/初识传说/尚待续织/散落的篇章）。
- `hints`：三级提示说明、使用三级提示本关封顶二星的规则、提示优先级。

## 扩展约定

1. 新增规则优先在 JSON 中加字段或取值，并同步更新本文件；卡片 `id` 保持永久稳定。
2. 主题标签只能从 `tagVocabulary` 取值；新状态加入 `flagCatalog`，新印记加入 `marks`。
3. 所有剧情文本（`description`、`combos.text`、`softHints.text`、`endings.text`、关卡说明）必须以策划书原文为依据，前端代码（`kongque.js`）中不硬编码剧情文字。
