import { defineGameModule } from "./game-template.js";

// —— 模块内部状态（README 建议⑤：游戏状态封闭在模块内，不写入 main.js）——
let mountedContainer = null;
let eventController = null;
let disposed = false; // fetch 返回前若已离开本模块，则放弃渲染，避免脏写
let gameData = null; // 载入的全部 JSON 数据
let cardIndex = null; // id → 卡片对象的索引
let levelId = 1; // 当前关卡
let activeTab = "scenes"; // 素材库当前分类：scenes / characters / events
let selected = null; // 素材库当前选中的卡：{ kind, id }
let arrangement = []; // 各幕编排：[{ scene, characters: [], event }]
let settledResult = null; // 最近一次提交的评估结果，null 表示未提交或已修改
let save = { unlocked: 1, best: {}, drafts: {}, lastLevel: 1, scrolls: [] }; // 存档：解锁进度、最佳成绩、编排草稿、织梦卷轴
let hintStage = 0; // 当前关卡已使用的提示等级 0–3（策划书 8.4）
let hintText = ""; // 最近一次提示文案
let hintCards = new Set(); // 三级提示高亮的卡片 "kind:id"
let theme = null; // 第 5 关当前随机命题
let rerollsLeft = 0; // 命题剩余更换次数（策划书第 5 关 rerolls）
let contentWarningAcked = false; // 第 3 关殉情内容警告是否已确认（策划书 9.5／验收6）
let tutorialStep = 0; // 教学关当前步骤（level.tutorial 数组索引）
let tutorialSubmitted = false; // 教学步骤目标 submitted：本次进入本关后是否提交过编排
let modalOpen = null; // 当前打开的模态框："scrolls" 织梦卷轴 / "codex" 图鉴 / "replay" 卷轴回放 / null
let replayScrollId = null; // 正在回放的卷轴 id
let scrollNote = ""; // 卷轴保存成功后的临时提示

// 数据文件地址随模块位置解析，不在代码中写死相对 HTML 的路径。
const DATA_URL = new URL("../assets/data/kongque-cards.json", import.meta.url);
const CARD_KINDS = ["scene", "character", "event"];
// 死亡/葬化类终结事件：有人死亡后，只允许这些事件继续出现（策划书 5.1 规则 7）。
const FINAL_EVENTS = ["E13", "E14", "E15"];
// localStorage 存档键（策划书 8.5：进度保存）。
const SAVE_KEY = "kongque-save-v1";

/** 读取本地存档；损坏或不存在时返回初始进度。 */
function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        unlocked: Math.max(1, Number(parsed.unlocked) || 1),
        best: typeof parsed.best === "object" && parsed.best ? parsed.best : {},
        drafts: typeof parsed.drafts === "object" && parsed.drafts ? parsed.drafts : {},
        lastLevel: Math.max(1, Number(parsed.lastLevel) || 1),
        scrolls: Array.isArray(parsed.scrolls) ? parsed.scrolls : [],
      };
    }
  } catch (error) {
    console.warn("孔雀东南飞：读取存档失败，将从第一关开始。", error);
  }
  return { unlocked: 1, best: {}, drafts: {}, lastLevel: 1, scrolls: [] };
}

/** 写入本地存档；隐私模式等写入失败时静默降级为不保存。 */
function persistSave() {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch (error) {
    console.warn("孔雀东南飞：写入存档失败，本次进度不会被保存。", error);
  }
}

/** 把当前编排与命题保存为该关草稿。 */
function persistDraft() {
  save.drafts[levelId] = {
    acts: arrangement.map((act) => ({
      scene: act.scene,
      characters: [...act.characters],
      event: act.event,
    })),
    theme: theme?.name ?? null,
    rerollsLeft,
    tutorialStep,
    tutorialSubmitted,
  };
  save.lastLevel = levelId;
  persistSave();
}

/** 从存档恢复某关草稿；关卡不匹配或数据无效时返回 null。 */
function restoreDraft(level) {
  const draft = save.drafts[level.id];
  if (!draft || !Array.isArray(draft.acts) || draft.acts.length !== level.acts) {
    return null;
  }
  return {
    acts: draft.acts.map((act) => ({
      scene: cardIndex.scene.has(act.scene) ? act.scene : null,
      characters: Array.isArray(act.characters)
        ? act.characters.filter((id) => cardIndex.character.has(id)).slice(0, 3)
        : [],
      event: cardIndex.event.has(act.event) ? act.event : null,
    })),
    themeName: draft.theme ?? null,
    rerollsLeft: Number(draft.rerollsLeft) || 0,
    tutorialStep: Math.max(0, Number(draft.tutorialStep) || 0),
    tutorialSubmitted: Boolean(draft.tutorialSubmitted),
  };
}

/**
 * 读取孔雀东南飞游戏数据（README 建议②：卡片与规则统一来自 data/ 目录）。
 * @returns {Promise<object>}
 */
async function loadCards() {
  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error(`卡片数据载入失败：${response.status}`);
  }
  return response.json();
}

/** 把 JSON 中的相对图片路径解析为绝对地址。 */
function imageOf(card) {
  return new URL(card.image, DATA_URL).href;
}

/** 按 id 取事件名称（找不到时回退显示 id）。 */
function eventName(id) {
  return cardIndex?.event.get(id)?.name ?? id;
}

/** 建立 id → 卡片对象索引，便于规则与界面按 id 查卡。 */
function buildIndex(data) {
  const index = { scene: new Map(), character: new Map(), event: new Map() };
  data.scenes.forEach((card) => index.scene.set(card.id, card));
  data.characters.forEach((card) => index.character.set(card.id, card));
  data.events.forEach((card) => index.event.set(card.id, card));
  return index;
}

/** 当前关卡对象。 */
function currentLevel() {
  return gameData.levels.find((level) => level.id === levelId) ?? gameData.levels[0];
}

/** 某类卡片在当前关卡卡池中可用的 id 集合（排除锁定卡）。 */
function poolIds(kind) {
  const level = currentLevel();
  const key = kind === "scene" ? "scenes" : kind === "character" ? "characters" : "events";
  const locked = new Set(kind === "event" ? level.pool.lockedEvents : []);
  return level.pool[key].filter((id) => !locked.has(id));
}

/** 按关卡初始化编排；教学关 preset 预置卡片（策划书 9.3）。 */
function createArrangement(level) {
  const next = Array.from({ length: level.acts }, () => ({
    scene: null,
    characters: [],
    event: null,
  }));
  (level.preset ?? []).forEach((preset) => {
    const act = next[preset.act - 1];
    if (act) {
      act.scene = preset.scene;
    }
  });
  return next;
}

/** 随机抽取第 5 关命题（策划书 9.6），并重置换题次数。 */
function rollTheme() {
  const level = currentLevel();
  const themes = level.themes ?? [];
  theme = themes.length > 0 ? themes[Math.floor(Math.random() * themes.length)] : null;
  rerollsLeft = level.rerolls ?? 0;
}

/** 切换关卡；未解锁的关卡不可进入。恢复草稿与命题，并重置提示状态。 */
function switchLevel(nextId) {
  const level = gameData.levels.find((item) => item.id === nextId);
  if (!level || nextId > save.unlocked) {
    return false;
  }
  levelId = nextId;
  selected = null;
  activeTab = "scenes";
  settledResult = null;
  hintStage = 0;
  hintCards = new Set();
  hintText = "";
  modalOpen = null;
  replayScrollId = null;
  scrollNote = "";
  // 每次进入第 3 关都重新提示殉情内容警告（策划书 9.5）。
  contentWarningAcked = nextId !== 3;

  const draft = restoreDraft(level);
  arrangement = draft ? draft.acts : createArrangement(level);
  tutorialStep = draft ? draft.tutorialStep : 0;
  tutorialSubmitted = draft ? draft.tutorialSubmitted : false;
  // 教学步骤越界保护（教程数组可能更新）。
  if (tutorialStep > (level.tutorial?.length ?? 0)) {
    tutorialStep = level.tutorial?.length ?? 0;
  }

  // 第 5 关命题：优先沿用存档中的命题，否则随机抽取。
  const savedTheme = (level.themes ?? []).find((item) => item.name === draft?.themeName);
  if (level.themes?.length > 0) {
    if (savedTheme) {
      theme = savedTheme;
      rerollsLeft = Math.min(draft.rerollsLeft, level.rerolls ?? 0);
    } else {
      rollTheme();
    }
  } else {
    theme = null;
    rerollsLeft = 0;
  }

  persistDraft();
  return true;
}

/** 记录通关结果：顺序解锁下一关，并保存本关最佳成绩（策划书 8.5）。 */
function recordResult(result) {
  const level = currentLevel();
  save.unlocked = Math.max(save.unlocked, Math.min(level.id + 1, gameData.levels.length));
  const prev = save.best[level.id];
  const better =
    !prev ||
    result.stars > prev.stars ||
    (result.stars === prev.stars && result.score.total > prev.score);
  if (better) {
    save.best[level.id] = {
      score: result.score.total,
      stars: result.stars,
      ending: result.ending?.id ?? null,
    };
  }
  persistSave();
}

/** 把素材库卡片放入指定幕槽；返回是否发生了变化。 */
function placeCard(actIndex, kind, id) {
  const act = arrangement[actIndex];
  if (!act) {
    return false;
  }
  if (kind === "scene") {
    if (act.scene === id) {
      return false;
    }
    act.scene = id;
  } else if (kind === "event") {
    if (act.event === id) {
      return false;
    }
    act.event = id;
  } else {
    // 角色槽 1–3 张：已在则忽略，未满则追加。
    if (act.characters.includes(id) || act.characters.length >= 3) {
      return false;
    }
    act.characters.push(id);
  }
  settledResult = null; // 编排变动后，旧结算失效
  scrollNote = ""; // 新结果尚未存卷，清除旧提示
  persistDraft();
  return true;
}

/** 从某幕移除指定类型卡片（角色按 id 移除）。 */
function removeCard(actIndex, kind, id) {
  const act = arrangement[actIndex];
  if (!act) {
    return;
  }
  if (kind === "scene") {
    act.scene = null;
  } else if (kind === "event") {
    act.event = null;
  } else {
    act.characters = act.characters.filter((cardId) => cardId !== id);
  }
  settledResult = null;
  scrollNote = "";
  persistDraft();
}

/** 某幕是否三类齐备。 */
function isActComplete(act) {
  return Boolean(act.scene && act.event && act.characters.length > 0);
}

/** 查找某幕命中的关键组合（策划书表 7、表 8）。 */
function findCombo(act) {
  return gameData.combos.find(
    (combo) =>
      combo.scene === act.scene &&
      combo.event === act.event &&
      combo.characters.every((id) => act.characters.includes(id)),
  );
}

/**
 * 按策划书 5.1 / 9.2 对整个编排逐幕推进评估。
 * 有效事件的 effects 才会累积进状态；无效组合不推进因果。
 * @returns {{actChecks: Array, state: object, score: object, ending: object|null,
 *           goalFailures: string[], passed: boolean, stars: number}}
 */
function evaluateStory() {
  const level = currentLevel();
  const flags = new Set();
  const marks = new Set();
  const deadCharacters = new Set();
  const occurredEvents = new Set();
  const usedScenes = new Set();
  const appearedCharacters = new Set();
  // 事件发生位置：玩家编排事件取幕次（0 起），autoAppend 追加事件取尾声序号，
  // 供 ordering 时序目标判断“追加事件发生在全部幕次之后”。
  const eventPositions = new Map();
  const actChecks = [];

  arrangement.forEach((act, index) => {
    const check = {
      actIndex: index,
      complete: isActComplete(act),
      valid: false,
      sceneOk: false,
      charsOk: false,
      preOk: false,
      stateOk: true,
      combo: null,
      issue: null,
      missingCharacters: [],
      missingPreEvents: [],
      missingAnyEvents: [],
      missingFlags: [],
      missingMarks: [],
      deadUsed: [],
    };

    if (check.complete) {
      const event = cardIndex.event.get(act.event);
      usedScenes.add(act.scene);
      act.characters.forEach((id) => appearedCharacters.add(id));

      // ① 场景适配
      check.sceneOk = event.allowedScenes.includes(act.scene);

      // ② 必备角色
      check.missingCharacters = event.requiredCharacters.filter(
        (id) => !act.characters.includes(id),
      );
      check.charsOk = check.missingCharacters.length === 0;

      // ③ 跨幕前置（events 全部出现过 / anyEvents 至少一个 / flags、marks 已成立）。
      //    若定义了 anyOf，则按“经典线／改写线”分支择一成立；
      //    全部不成立时取缺失项最少的分支生成引导文案。
      const prereq = event.prerequisites;
      if (Array.isArray(prereq.anyOf) && prereq.anyOf.length > 0) {
        const branchResults = prereq.anyOf.map((branch) => ({
          missingPreEvents: (branch.events ?? []).filter((id) => !occurredEvents.has(id)),
          missingAnyEvents:
            (branch.anyEvents ?? []).length > 0 &&
            (branch.anyEvents ?? []).every((id) => !occurredEvents.has(id))
              ? branch.anyEvents
              : [],
          missingFlags: (branch.flags ?? []).filter((id) => !flags.has(id)),
          missingMarks: (branch.marks ?? []).filter((id) => !marks.has(id)),
        }));
        const missingCount = (item) =>
          item.missingPreEvents.length +
          item.missingAnyEvents.length +
          item.missingFlags.length +
          item.missingMarks.length;
        const passedBranch = branchResults.find((item) => missingCount(item) === 0);
        const closest =
          passedBranch ??
          branchResults.reduce((a, b) => (missingCount(a) <= missingCount(b) ? a : b));
        check.preOk = Boolean(passedBranch);
        check.missingPreEvents = closest.missingPreEvents;
        check.missingAnyEvents = closest.missingAnyEvents;
        check.missingFlags = closest.missingFlags;
        check.missingMarks = closest.missingMarks;
      } else {
        check.missingPreEvents = prereq.events.filter((id) => !occurredEvents.has(id));
        check.missingAnyEvents =
          prereq.anyEvents.length > 0 &&
          prereq.anyEvents.every((id) => !occurredEvents.has(id))
            ? prereq.anyEvents
            : [];
        check.missingFlags = prereq.flags.filter((id) => !flags.has(id));
        check.preOk =
          check.missingPreEvents.length === 0 &&
          check.missingAnyEvents.length === 0 &&
          check.missingFlags.length === 0;
      }

      // ④ 状态冲突：禁止状态已成立 / 已死角色仍登场 / 死后安排非终结事件
      const forbidden = prereq.forbiddenFlags.filter((id) => flags.has(id));
      check.deadUsed = act.characters.filter((id) => deadCharacters.has(id));
      const eventAfterDeath =
        deadCharacters.size > 0 && !FINAL_EVENTS.includes(event.id);
      check.stateOk = forbidden.length === 0 && check.deadUsed.length === 0 && !eventAfterDeath;
      check.forbiddenFlags = forbidden;

      check.combo = findCombo(act);
      check.valid = check.sceneOk && check.charsOk && check.preOk && check.stateOk;

      // 有效组合才推进故事状态。
      if (check.valid) {
        occurredEvents.add(event.id);
        if (!eventPositions.has(event.id)) {
          eventPositions.set(event.id, index);
        }
        event.effects.flags.forEach((id) => flags.add(id));
        event.effects.marks.forEach((id) => marks.add(id));
        event.effects.deaths.forEach((id) => deadCharacters.add(id));
      }

      check.issue = buildIssue(index, act, event, check);
    }

    actChecks.push(check);
  });

  // 关卡规定的结局自动追加演出（策划书 9.7：殉情后仲卿殉情、合葬与化鸟自动进入尾声）。
  // 追加事件只进入状态与结局判定，不占用幕槽、不产生扣分项；
  // 其发生位置按追加顺序记为“最后一幕之后”，供 ordering 目标校验。
  let appendPosition = arrangement.length;
  (level.autoAppend ?? []).forEach((rule) => {
    if (rule.after.every((id) => occurredEvents.has(id))) {
      rule.events.forEach((id) => {
        if (occurredEvents.has(id)) {
          return;
        }
        occurredEvents.add(id);
        eventPositions.set(id, appendPosition++);
        const appended = cardIndex.event.get(id);
        appended?.effects.flags.forEach((flag) => flags.add(flag));
        appended?.effects.marks.forEach((mark) => marks.add(mark));
        appended?.effects.deaths.forEach((charId) => deadCharacters.add(charId));
      });
    }
  });

  const state = { flags, marks, deadCharacters, occurredEvents, usedScenes, appearedCharacters };
  const score = calculateScore(actChecks, state);
  const ending = pickEnding(score, state);
  const goalFailures = checkGoals(level, actChecks, state, ending, eventPositions);
  // 第 5 关随机命题的附加要求（策划书 9.6）。
  goalFailures.push(...checkThemeRequirements(actChecks, state));
  const passed = score.total >= level.passScore && goalFailures.length === 0;

  // 星级（策划书 8.3、9.2 规则4）：一星通关；二星 80 分且无严重逻辑错误；
  // 三星 90 分、无严重逻辑错误，并完成本关结构化挑战目标（level.threeStar）。
  const contradictionCount = actChecks.filter(
    (check) => check.complete && !check.stateOk,
  ).length;
  let stars = 0;
  let starFailures = [];
  if (passed) {
    stars = 1;
    if (score.total >= 80 && contradictionCount === 0) {
      stars = 2;
    }
    starFailures = checkThreeStar(level, {
      actChecks,
      state,
      score,
      ending,
      eventPositions,
    });
    if (
      score.total >= gameData.scoring.legend &&
      contradictionCount === 0 &&
      starFailures.length === 0
    ) {
      stars = 3;
    }
  }
  // 三级提示规则：使用后本关最高二星（策划书 8.4）。
  if (hintStage >= 3) {
    stars = Math.min(stars, 2);
  }

  return { actChecks, state, score, ending, goalFailures, passed, stars, starFailures };
}

/**
 * 评估本关三星挑战（策划书 9.2 规则4 与各关“挑战目标”、9.7 第五关三星条件）。
 * 返回未满足项文案；空数组表示挑战完成。条件全部数据化，缺省键不参与判定。
 */
function checkThreeStar(level, ctx) {
  const cfg = level.threeStar;
  if (!cfg || typeof cfg !== "object") {
    return [];
  }
  const { actChecks, state, score, ending, eventPositions } = ctx;
  const validChecks = actChecks.filter((check) => check.valid);
  const failures = [];

  if (typeof cfg.minScore === "number" && score.total < cfg.minScore) {
    failures.push(`挑战要求总分不低于 ${cfg.minScore} 分（当前 ${score.total} 分）。`);
  }
  if (typeof cfg.minCulture === "number" && score.culture < cfg.minCulture) {
    failures.push(`挑战要求文化还原度不低于 ${cfg.minCulture} 分（当前 ${score.culture} 分）。`);
  }

  (cfg.ordering ?? []).forEach((rule) => {
    const positionOf = (id) => (eventPositions?.has(id) ? eventPositions.get(id) : -1);
    const beforeAt = positionOf(rule.before);
    const afters = Array.isArray(rule.after)
      ? rule.after
      : rule.after
        ? [rule.after]
        : rule.afterAny ?? [];
    const afterPositions = afters.map(positionOf);
    const afterAt = afterPositions.length > 0 ? Math.min(...afterPositions) : -1;
    if (beforeAt === -1 || afterAt === -1 || beforeAt >= afterAt) {
      failures.push(
        `挑战要求按「${eventName(rule.before)}」→「${afters.map(eventName).join("／")}」的因果顺序排列。`,
      );
    }
  });

  if (Array.isArray(cfg.tags) && cfg.tags.length > 0) {
    const hit = collectTags(validChecks);
    cfg.tags
      .filter((tag) => !hit.has(tag))
      .forEach((tag) => failures.push(`挑战要求同时命中主题标签「${tag}」。`));
  }

  if (Array.isArray(cfg.imageryEvents) && typeof cfg.minImagery === "number") {
    const used = cfg.imageryEvents.filter((id) => state.occurredEvents.has(id));
    if (used.length < cfg.minImagery) {
      failures.push(
        `挑战要求至少使用 ${cfg.minImagery} 个经典意象（${cfg.imageryEvents
          .map(eventName)
          .join("、")}，当前命中 ${used.length} 个）。`,
      );
    }
  }

  (cfg.forbiddenEvents ?? []).forEach((id) => {
    if (state.occurredEvents.has(id)) {
      failures.push(`挑战要求不使用「${eventName(id)}」完成本关。`);
    }
  });

  if (Array.isArray(cfg.endings) && cfg.endings.length > 0) {
    if (!ending || !cfg.endings.includes(ending.id)) {
      failures.push("挑战要求以指定的非悲剧结局收束故事。");
    }
  }

  if (typeof cfg.minDistinctScenes === "number") {
    if (state.usedScenes.size < cfg.minDistinctScenes) {
      failures.push(
        `挑战要求至少使用 ${cfg.minDistinctScenes} 个不同场景（当前 ${state.usedScenes.size} 个）。`,
      );
    }
  }

  if (cfg.noDuplicateEvents) {
    const ids = validChecks.map((check) => arrangement[check.actIndex].event);
    const duplicated = ids.find((id) => ids.indexOf(id) !== ids.lastIndexOf(id));
    if (duplicated) {
      failures.push("挑战要求五幕事件互不重复。");
    }
  }

  // 来源混搭：策划书 9.7 要求原作核心、传说表达、游戏新增三类卡均有使用。
  if (cfg.sourceMix && typeof cfg.sourceMix === "object") {
    const sourceCount = { core: 0, legend: 0, added: 0 };
    validChecks.forEach((check) => {
      const source = cardIndex.event.get(arrangement[check.actIndex].event)?.source;
      if (source in sourceCount) {
        sourceCount[source] += 1;
      }
    });
    Object.entries(cfg.sourceMix).forEach(([source, min]) => {
      if (sourceCount[source] < min) {
        const label = { core: "原作核心", legend: "传说表达", added: "游戏新增" }[source] ?? source;
        failures.push(`挑战要求至少使用 ${min} 张${label}事件卡（当前 ${sourceCount[source]} 张）。`);
      }
    });
  }

  if (cfg.noLevel3Hint && hintStage >= 3) {
    failures.push("挑战要求不使用三级提示。");
  }

  if (cfg.differentEndingFromLast) {
    const lastEnding = save.best?.[level.id]?.ending;
    if (!ending || (lastEnding && ending.id === lastEnding)) {
      failures.push("挑战要求触发与上次通关不同的结局。");
    }
  }

  return failures;
}

/** 取某事件对应的柔性提示（策划书表 9）。 */
function findSoftHint(eventId, type, sceneId) {
  return gameData.softHints.find((hint) => {
    if (hint.event !== eventId || hint.type !== type) {
      return false;
    }
    if (type === "eventNotInScene" && hint.badScenes.length > 0) {
      return hint.badScenes.includes(sceneId);
    }
    return true;
  });
}

/**
 * 按“缺少人物—结局过早—场景不符—前置缺失—状态冲突”的优先级只生成一条提示。
 * 文案优先取数据中的 softHints；没有专用条目时用规则生成通用引导语。
 */
function buildIssue(index, act, event, check) {
  const charName = (id) => cardIndex.character.get(id)?.name ?? id;
  const eventName = (id) => cardIndex.event.get(id)?.name ?? id;
  const flagName = (id) => gameData.flagCatalog.find((flag) => flag.id === id)?.name ?? id;
  const markName = (id) => gameData.marks.find((mark) => mark.id === id)?.name ?? id;

  if (check.missingCharacters.length > 0) {
    const hint = findSoftHint(event.id, "missingCharacter");
    return (
      hint?.text ??
      `「${event.name}」还缺少必要人物：${check.missingCharacters.map(charName).join("、")}。`
    );
  }

  const earlyHint = findSoftHint(event.id, "actTooEarly");
  if (earlyHint && index < earlyHint.maxBadAct) {
    return earlyHint.text;
  }

  if (!check.sceneOk) {
    const hint = findSoftHint(event.id, "eventNotInScene", act.scene);
    const sceneName = cardIndex.scene.get(act.scene)?.name ?? "";
    return hint?.text ?? `「${event.name}」似乎不会发生在${sceneName}，换个场景试试。`;
  }

  if (!check.preOk) {
    const hint = findSoftHint(event.id, "missingPrerequisite");
    if (hint) {
      return hint.text;
    }
    const reasons = [];
    check.missingPreEvents.forEach((id) => reasons.push(`需要先发生「${eventName(id)}」`));
    if (check.missingAnyEvents.length > 0) {
      reasons.push(`需要先有「${check.missingAnyEvents.map(eventName).join("」或「")}」`);
    }
    check.missingFlags.forEach((id) => reasons.push(`故事中还缺少“${flagName(id)}”的铺垫`));
    check.missingMarks.forEach((id) => reasons.push(`需要先达成“${markName(id)}”`));
    return reasons[0] ?? "这一事件还缺少前置铺垫。";
  }

  if (!check.stateOk) {
    if (check.deadUsed.length > 0) {
      return `故事中的${check.deadUsed.map(charName).join("、")}已经走向结局，不能再次登场。`;
    }
    return `人物既已走向悲剧结局，「${event.name}」便不应再发生——除非你改写前面的抉择。`;
  }

  return null;
}

/** 四维评分（策划书 8.1、8.2；分值参数全部取自 scoring）。 */
function calculateScore(actChecks, state) {
  const cfg = gameData.scoring;
  const level = currentLevel();
  const actCount = level.acts;
  const completeActs = actChecks.filter((check) => check.complete);
  const validActs = actChecks.filter((check) => check.valid);

  // 完整度（策划书 8.2）：每形成一幕“有效组合”+perValidAct，全幕有效 +allPhasesBonus；
  // 按本关幕数归一化到 30。注意按“有效”而非“齐备”计——放齐但逻辑不成立的幕不完整。
  const completenessRaw =
    validActs.length * cfg.perValidAct +
    (validActs.length === actCount ? cfg.allPhasesBonus : 0);
  let completeness = clamp(
    (completenessRaw / (actCount * cfg.perValidAct + cfg.allPhasesBonus)) *
      cfg.dimensions.completeness,
    0,
    cfg.dimensions.completeness,
  );

  // 逻辑分：每个齐备幕的场景/人物/前置/状态四项检查，归一化到 30，矛盾按次扣分。
  const logicPoints = completeActs.reduce((sum, check) => {
    return sum + [check.sceneOk, check.charsOk, check.preOk, check.stateOk].filter(Boolean).length;
  }, 0);
  const contradictions = actChecks.filter((check) => check.complete && !check.stateOk).length;
  let logic = clamp(
    (logicPoints / (completeActs.length * 4 || 1)) * cfg.dimensions.logic -
      contradictions * cfg.contradictionPenalty,
    0,
    cfg.dimensions.logic,
  );

  // 主题分：命中关卡目标标签的比例；未定义目标标签时按有效幕覆盖率计分。
  let theme;
  const targetTags = level.goals.tags ?? [];
  if (targetTags.length > 0) {
    const hitTags = collectTags(validActs);
    const hit = targetTags.filter((tag) => hitTags.has(tag)).length;
    theme = (hit / targetTags.length) * cfg.dimensions.theme;
  } else {
    theme = (validActs.length / actCount) * cfg.dimensions.theme;
  }
  theme = clamp(theme, 0, 25);

  // 文化还原度（策划书 8.2）：三位核心人物“使用”即加 5 分（各幕登场即可，不要求同场）；
  // 经典意象（誓言/东南枝/双鸟）每出现一处加 4 分；封顶 15。
  let culture = 0;
  if (cfg.coreCharacters.every((id) => state.appearedCharacters.has(id))) {
    culture += cfg.coreCharactersBonus;
  }
  cfg.imagery.forEach((item) => {
    if (state.occurredEvents.has(item.ref)) {
      culture += item.max;
    }
  });
  culture = clamp(culture, 0, cfg.dimensions.culture);

  // 关卡专项加分（策划书 9.4 书信连接 +3 逻辑分、9.5 仲卿诀别额外完整度）。
  (level.scoreBonuses ?? []).forEach((bonus) => {
    if (state.occurredEvents.has(bonus.event)) {
      if (bonus.dimension === "completeness") {
        completeness = clamp(completeness + bonus.points, 0, cfg.dimensions.completeness);
      } else if (bonus.dimension === "logic") {
        logic = clamp(logic + bonus.points, 0, cfg.dimensions.logic);
      }
    }
  });

  const total = clamp(
    Math.round(completeness + logic + theme + culture),
    cfg.range[0],
    cfg.range[1],
  );
  return {
    completeness: Math.round(completeness),
    logic: Math.round(logic),
    theme: Math.round(theme),
    culture: Math.round(culture),
    total,
  };
}

/** 收集有效幕中场景/角色/事件的全部主题标签。 */
function collectTags(validChecks) {
  const tags = new Set();
  validChecks.forEach((check) => {
    const act = arrangement[check.actIndex];
    cardIndex.scene.get(act.scene)?.tags.forEach((tag) => tags.add(tag));
    cardIndex.event.get(act.event)?.tags.forEach((tag) => tags.add(tag));
    act.characters.forEach((id) => {
      cardIndex.character.get(id)?.tags.forEach((tag) => tags.add(tag));
    });
  });
  return tags;
}

/** 本关结局结算顺序：按 priority 升序；关卡可用 endingPriority 覆盖（策划书 9.7）。 */
function orderedEndings() {
  const level = currentLevel();
  const sorted = [...gameData.endings].sort((a, b) => a.priority - b.priority);
  if (Array.isArray(level.endingPriority)) {
    const order = new Map(level.endingPriority.map((id, index) => [id, index]));
    sorted.sort(
      (a, b) => (order.get(a.id) ?? sorted.length) - (order.get(b.id) ?? sorted.length),
    );
  }
  return sorted;
}

/** 某结局条件是否被当前状态满足（策划书 endings.condition，各键为“与”关系）。 */
function endingMet(ending, score, state) {
  const c = ending.condition;
  const actsById = (ids) => ids.every((id) => state.occurredEvents.has(id));
  const anyByIds = (ids, set) => ids.length === 0 || ids.some((id) => set.has(id));
  return (
    actsById(c.events) &&
    anyByIds(c.anyEvents, state.occurredEvents) &&
    c.scenes.every((id) => state.usedScenes.has(id)) &&
    anyByIds(c.anyScenes, state.usedScenes) &&
    c.characters.every((id) => state.appearedCharacters.has(id)) &&
    anyByIds(c.anyCharacters, state.appearedCharacters) &&
    c.marks.every((id) => state.marks.has(id)) &&
    c.flags.every((id) => state.flags.has(id)) &&
    c.forbiddenFlags.every((id) => !state.flags.has(id)) &&
    score.total >= c.minScore &&
    score.culture >= c.minCulture
  );
}

/** 按 priority 升序取第一个满足条件的结局（策划书 9.7）。 */
function pickEnding(score, state) {
  return orderedEndings().find((ending) => endingMet(ending, score, state)) ?? null;
}

/** 除首个结算结局外，其余条件同样被满足的结局（结算页“其他已满足结局”）。 */
function satisfiedEndings(score, state) {
  return orderedEndings().filter((ending) => endingMet(ending, score, state));
}

/** 检查关卡通关目标；返回未满足项的说明（空数组表示全部满足）。 */
function checkGoals(level, actChecks, state, ending, eventPositions) {
  const goals = level.goals;
  const failures = [];
  const completeChecks = actChecks.filter((check) => check.complete);
  const validChecks = actChecks.filter((check) => check.valid);
  const charName = (id) => cardIndex.character.get(id)?.name ?? id;
  const eventName = (id) => cardIndex.event.get(id)?.name ?? id;

  if (goals.allActsValid && validChecks.length !== level.acts) {
    failures.push("尚有幕次未形成有效组合。");
  }

  (goals.cooccur ?? []).forEach((group) => {
    const together = completeChecks.some((check) =>
      group.every((id) => arrangement[check.actIndex].characters.includes(id)),
    );
    if (!together) {
      failures.push(`「${group.map(charName).join("」与「")}」需要至少在同一幕出现。`);
    }
  });

  (goals.mustIncludeCharacters ?? []).forEach((id) => {
    if (!state.appearedCharacters.has(id)) {
      failures.push(`故事中必须出现「${charName(id)}」。`);
    }
  });

  const targetTags = goals.tags ?? [];
  if (targetTags.length > 0) {
    const hitTags = collectTags(validChecks);
    targetTags
      .filter((tag) => !hitTags.has(tag))
      .forEach((tag) => failures.push(`故事尚未体现主题「${tag}」。`));
  }

  (goals.ordering ?? []).forEach((rule) => {
    // 事件位置来自 eventPositions：玩家编排事件为其幕次，
    // autoAppend 追加事件为最后一幕之后的尾声序号（见 evaluateStory）。
    const positionOf = (id) => (eventPositions?.has(id) ? eventPositions.get(id) : -1);
    const beforeAt = positionOf(rule.before);
    // after 兼容字符串或数组两种写法；afterAny 始终为数组。
    const afters = Array.isArray(rule.after)
      ? rule.after
      : rule.after
        ? [rule.after]
        : rule.afterAny ?? [];
    const afterPositions = afters.map(positionOf);
    const afterAt = afterPositions.length > 0 ? Math.min(...afterPositions) : -1;
    if (beforeAt === -1 || afterAt === -1 || beforeAt >= afterAt) {
      failures.push(`「${eventName(rule.before)}」应安排在「${afters.map(eventName).join("」或「")}」之前。`);
    }
  });

  if (goals.forbiddenDeaths && state.deadCharacters.size > 0) {
    failures.push("本关需要改写命运，不能走向死亡结局。");
  }

  // 第 2 关：四阶段叙事必须依次成立（策划书 9.4：家庭冲突→求情失败→遣归辞别→娘家压力）。
  // flowStages 为每阶段可接受的事件 id 组；允许同一事件（如 E04）同时承载相邻两阶段，
  // 因此各阶段首次命中位置只需“不后退”，不要求严格递增。
  if (Array.isArray(goals.flowStages) && goals.flowStages.length > 0) {
    const positionOf = (id) => (eventPositions?.has(id) ? eventPositions.get(id) : -1);
    let previous = -1;
    let broken = false; // 已有阶段缺失时，后续只检查缺失，不再检查顺序
    goals.flowStages.forEach((stage, stageIndex) => {
      const hits = stage.map(positionOf).filter((pos) => pos >= 0);
      const first = hits.length > 0 ? Math.min(...hits) : -1;
      const stageLabel = goals.flow?.[stageIndex] ?? `阶段${stageIndex + 1}`;
      if (first === -1) {
        failures.push(`故事缺少「${stageLabel}」阶段（可用 ${stage.map(eventName).join("或")}）。`);
        broken = true;
      } else if (!broken && first < previous) {
        failures.push(`「${stageLabel}」阶段出现过早，应按四阶段顺序推进。`);
      }
      previous = first;
    });
  }

  // 第 4 关：前 N 幕内必须出现至少 min 个明确冲突节点（策划书 9.6）。
  if (goals.conflictInFirstActs && typeof goals.conflictInFirstActs === "object") {
    const window = goals.conflictInFirstActs.acts ?? 2;
    const min = goals.conflictInFirstActs.min ?? 1;
    const nodes = actChecks.filter(
      (check) =>
        check.valid &&
        check.actIndex < window &&
        eventHasAnyTag(arrangement[check.actIndex].event, gameData.conflictTags),
    ).length;
    if (nodes < min) {
      failures.push(`前 ${window} 幕必须出现至少 ${min} 次明确冲突（家庭权力或礼教压迫）。`);
    }
  }

  if (typeof goals.minAddedEvents === "number") {
    const addedAfter = actChecks.filter(
      (check) =>
        check.complete &&
        check.actIndex >= (goals.addedEventsAfterAct ?? 0) &&
        cardIndex.event.get(arrangement[check.actIndex].event)?.source === "added",
    ).length;
    if (addedAfter < goals.minAddedEvents) {
      failures.push(`至少需要在前期冲突之后使用 ${goals.minAddedEvents} 个改写事件。`);
    }
  }

  if (typeof goals.minConflictNodes === "number") {
    const nodes = actChecks.filter(
      (check) => check.valid && eventHasAnyTag(arrangement[check.actIndex].event, gameData.conflictTags),
    ).length;
    if (nodes < goals.minConflictNodes) {
      failures.push(`至少需要 ${goals.minConflictNodes} 幕展现冲突节点（如家庭权力、礼教压迫）。`);
    }
  }

  if (typeof goals.minDecisionNodes === "number") {
    const nodes = actChecks.filter(
      (check) => check.valid && eventHasAnyTag(arrangement[check.actIndex].event, gameData.decisionTags),
    ).length;
    if (nodes < goals.minDecisionNodes) {
      failures.push(`至少需要 ${goals.minDecisionNodes} 幕展现主动抉择（如婚姻自主、命运改写）。`);
    }
  }

  if (goals.explicitEnding && !ending) {
    failures.push("故事还没有形成明确的结局。");
  }
  if (goals.noStateConflict && actChecks.some((check) => check.complete && !check.stateOk)) {
    failures.push("故事中存在状态冲突（如人物死后仍登场）。");
  }

  if (Array.isArray(goals.endings) && goals.endings.length > 0) {
    if (!ending || !goals.endings.includes(ending.id)) {
      const names = goals.endings
        .map((id) => gameData.endings.find((item) => item.id === id)?.name ?? id)
        .join("或");
      failures.push(`本关需要达成「${names}」结局。`);
    }
  }

  return failures;
}

/** 事件是否带有指定标签中的任意一个。 */
function eventHasAnyTag(eventId, tags) {
  const event = cardIndex.event.get(eventId);
  if (!event || !Array.isArray(tags)) {
    return false;
  }
  return event.tags.some((tag) => tags.includes(tag));
}

/**
 * 校验第 5 关随机命题（策划书 9.6）：主题标签、同台幕数、冲突角色数、
 * 终幕主导、角色成长线、印记、禁用事件与终幕场景。
 * @returns {string[]} 未满足项说明（空数组表示命题达成）
 */
function checkThemeRequirements(actChecks, state) {
  if (!theme) {
    return [];
  }
  const failures = [];
  const validChecks = actChecks.filter((check) => check.valid);
  const completeChecks = actChecks.filter((check) => check.complete);
  const lastAct = arrangement[arrangement.length - 1];
  const lastCheck = actChecks[arrangement.length - 1];
  const charName = (id) => cardIndex.character.get(id)?.name ?? id;
  const eventName = (id) => cardIndex.event.get(id)?.name ?? id;
  const sceneName = (id) => cardIndex.scene.get(id)?.name ?? id;
  const markName = (id) => gameData.marks.find((mark) => mark.id === id)?.name ?? id;
  const hitTags = collectTags(validChecks);

  (theme.tags ?? []).forEach((tag) => {
    if (!hitTags.has(tag)) {
      failures.push(`命题「${theme.name}」要求体现主题「${tag}」。`);
    }
  });

  if (Array.isArray(theme.cooccur) && theme.cooccur.length > 0) {
    const minActs = theme.cooccurMinActs ?? 1;
    const together = completeChecks.filter((check) =>
      theme.cooccur.every((id) => arrangement[check.actIndex].characters.includes(id)),
    ).length;
    if (together < minActs) {
      failures.push(
        `命题要求「${theme.cooccur.map(charName).join("」「")}」至少在 ${minActs} 幕共同登场（当前 ${together} 幕）。`,
      );
    }
  }

  if (typeof theme.minConflictCharacters === "number") {
    const count = [...state.appearedCharacters].filter((id) =>
      cardIndex.character.get(id)?.tags.some((tag) => gameData.conflictTags?.includes(tag)),
    ).length;
    if (count < theme.minConflictCharacters) {
      failures.push(
        `命题要求至少 ${theme.minConflictCharacters} 名卷入冲突的角色登场（当前 ${count} 人）。`,
      );
    }
  }

  if (theme.finalActLedBy && (!lastCheck?.complete || !lastAct.characters.includes(theme.finalActLedBy))) {
    failures.push(`命题要求终幕由「${charName(theme.finalActLedBy)}」登场主导。`);
  }

  (theme.characterArc ?? []).forEach((id) => {
    const acts = completeChecks.filter((check) =>
      arrangement[check.actIndex].characters.includes(id),
    ).length;
    if (acts < 2) {
      failures.push(`命题要求「${charName(id)}」在至少两幕中形成成长线（当前 ${acts} 幕）。`);
    }
  });

  (theme.mustIncludeCharacters ?? []).forEach((id) => {
    if (!state.appearedCharacters.has(id)) {
      failures.push(`命题要求故事中出现「${charName(id)}」。`);
    }
  });

  (theme.marks ?? []).forEach((id) => {
    if (!state.marks.has(id)) {
      failures.push(`命题要求达成“${markName(id)}”。`);
    }
  });

  (theme.forbiddenEvents ?? []).forEach((id) => {
    if (state.occurredEvents.has(id)) {
      failures.push(`命题「${theme.name}」不能使用「${eventName(id)}」。`);
    }
  });

  if (theme.finalScene && (!lastCheck?.complete || lastAct.scene !== theme.finalScene)) {
    failures.push(`命题要求终幕场景为「${sceneName(theme.finalScene)}」。`);
  }

  return failures;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * 计算当前等级的提示文案（策划书 8.4 三级提示）。
 * 一级指出问题所在幕；二级指出缺少的卡片类型或因果条件；
 * 三级给出具体卡片建议并高亮，使用后本关最高二星。
 */
function buildHint() {
  const checks = (settledResult ?? evaluateStory()).actChecks;
  const actNo = (index) => `第${["一", "二", "三", "四", "五"][index]}幕`;
  const target = checks.find((check) => !check.complete || !check.valid);

  if (!target) {
    hintCards = new Set();
    return "各幕组合目前均成立；可对照本关挑战继续优化，冲击更高星级。";
  }

  const act = arrangement[target.actIndex];
  const event = target.complete ? cardIndex.event.get(act.event) : null;

  if (hintStage === 1) {
    return `问题出现在${actNo(target.actIndex)}，请检查该幕的场景、角色与事件组合。`;
  }

  if (hintStage === 2) {
    if (!target.complete) {
      const missing = [!act.scene && "场景", act.characters.length === 0 && "角色", !act.event && "事件"].filter(
        Boolean,
      );
      return `${actNo(target.actIndex)}尚未放齐，还缺少：${missing.join("、")}。`;
    }
    if (target.missingCharacters.length > 0) {
      const names = target.missingCharacters.map((id) => cardIndex.character.get(id)?.name ?? id);
      return `${actNo(target.actIndex)}的事件需要角色「${names.join("」「")}」在场。`;
    }
    if (!target.sceneOk) {
      return `「${event.name}」与${actNo(target.actIndex)}的场景不符，需要更换该幕场景。`;
    }
    if (!target.preOk) {
      const reasons = target.missingPreEvents.map(
        (id) => `先发生「${cardIndex.event.get(id)?.name ?? id}」`,
      );
      if (target.missingAnyEvents.length > 0) {
        reasons.push(
          `先有「${target.missingAnyEvents.map((id) => cardIndex.event.get(id)?.name ?? id).join("」或「")}」`,
        );
      }
      target.missingFlags.forEach((id) => {
        const flag = gameData.flagCatalog.find((item) => item.id === id);
        reasons.push(`铺垫“${flag?.name ?? id}”`);
      });
      target.missingMarks.forEach((id) => {
        const mark = gameData.marks.find((item) => item.id === id);
        reasons.push(`先达成“${mark?.name ?? id}”`);
      });
      return `${actNo(target.actIndex)}的「${event.name}」需要${reasons.join("，")}。`;
    }
    if (!target.stateOk) {
      return target.deadUsed.length > 0
        ? `${actNo(target.actIndex)}中的${target.deadUsed
            .map((id) => cardIndex.character.get(id)?.name ?? id)
            .join("、")}已走向结局，需要更换角色。`
        : `${actNo(target.actIndex)}在悲剧发生后不能安排「${event.name}」，请调整前面的抉择。`;
    }
  }

  return buildLevel3Hint(target, actNo(target.actIndex));
}

/** 三级提示：优先取关卡推荐编排，否则在组合表中找可成立的组合；命中的卡片在素材库高亮。 */
function buildLevel3Hint(target, actNoText) {
  const level = currentLevel();
  const picks = [];
  const nameOf = (kind, id) => cardIndex[kind].get(id)?.name ?? id;
  const kindName = { scene: "场景", character: "角色", event: "事件" };

  // 推荐编排的来源：第 5 关随机命题优先使用该命题自带的 recommended，
  // 其余关卡使用关卡级 recommended；都没有时回退到组合表。
  const recommendedList =
    (theme?.recommended ?? []).length > 0 ? theme.recommended : (level.recommended ?? []);
  const recommended = recommendedList.find((item) => item.act === target.actIndex + 1);
  if (recommended) {
    if (recommended.scene) {
      // 推荐场景可能写作 "S04/S05"，拆开后一并高亮供选择。
      String(recommended.scene)
        .split("/")
        .forEach((id) => picks.push(["scene", id.trim()]));
    }
    (recommended.characters ?? []).forEach((id) => picks.push(["character", id]));
    if (recommended.event) {
      // 推荐事件可能写作 "E05/E06"，拆开后一并高亮供选择。
      String(recommended.event)
        .split("/")
        .forEach((id) => picks.push(["event", id.trim()]));
    }
  } else {
    // 无推荐数据的关卡：在组合表中查找素材齐备且事件未被使用的组合。
    const usedEvents = new Set(arrangement.map((item) => item.event));
    const combo = gameData.combos.find(
      (item) =>
        poolIds("scene").includes(item.scene) &&
        poolIds("event").includes(item.event) &&
        item.characters.every((id) => poolIds("character").includes(id)) &&
        !usedEvents.has(item.event),
    );
    if (combo) {
      picks.push(["scene", combo.scene], ["event", combo.event]);
      combo.characters.forEach((id) => picks.push(["character", id]));
    }
  }

  hintCards = new Set(picks.map(([kind, id]) => `${kind}:${id}`));

  if (picks.length === 0) {
    return `${actNoText}的组合尚未成立；请对照卡片的“发生地点／需要人物／前置条件”自行调整。`;
  }
  const described = picks.map(([kind, id]) => `${kindName[kind]}「${nameOf(kind, id)}」`);
  return `${actNoText}建议使用：${described.join("、")}（已在素材库中高亮）。`;
}

/** 创建一张素材库卡片按钮。 */
function createPickButton(kind, card) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "kongque-pick";
  button.dataset.pick = `${kind}:${card.id}`;
  if (selected?.kind === kind && selected.id === card.id) {
    button.classList.add("is-selected");
  }
  if (hintCards.has(`${kind}:${card.id}`)) {
    button.classList.add("is-hinted");
  }

  const img = document.createElement("img");
  img.className = "kongque-pick__image";
  img.src = imageOf(card);
  img.alt = "";
  img.loading = "lazy";

  // 来源角标（策划书 2.1／验收5）：原作核心／传说表达／织梦改写。
  const sourceLabels = { core: "原作", legend: "传说", added: "织梦改写" };
  if (card.source && sourceLabels[card.source]) {
    const badge = document.createElement("span");
    badge.className = `kongque-pick__source is-${card.source}`;
    badge.textContent = sourceLabels[card.source];
    button.append(badge);
  }

  const label = document.createElement("span");
  label.className = "kongque-pick__label";

  const idText = document.createElement("span");
  idText.className = "kongque-pick__id";
  idText.textContent = card.id;

  const nameText = document.createElement("span");
  nameText.className = "kongque-pick__name";
  nameText.textContent = card.name;

  label.append(idText, nameText);
  button.append(img, label);
  return button;
}

/** 渲染左栏：分类页签 + 当前关卡卡池。 */
function renderLibrary() {
  const panel = document.createElement("aside");
  panel.className = "kongque-library";

  const tabs = document.createElement("div");
  tabs.className = "kongque-tabs";
  tabs.setAttribute("role", "tablist");
  [
    ["scenes", "场景"],
    ["characters", "角色"],
    ["events", "事件"],
  ].forEach(([key, label]) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "kongque-tabs__item";
    tab.dataset.tab = key;
    tab.setAttribute("role", "tab");
    if (key === activeTab) {
      tab.classList.add("is-active");
      tab.setAttribute("aria-selected", "true");
    }
    tab.textContent = label;
    tabs.append(tab);
  });

  const kind = activeTab === "scenes" ? "scene" : activeTab === "characters" ? "character" : "event";
  const grid = document.createElement("div");
  grid.className = "kongque-library__grid";
  poolIds(kind).forEach((id) => {
    const card = cardIndex[kind].get(id);
    if (card) {
      grid.append(createPickButton(kind, card));
    }
  });

  const hint = document.createElement("p");
  hint.className = "kongque-library__hint";
  hint.textContent = selected
    ? `已选中 ${selected.id}，点击中间故事面板的对应卡槽放入；再次点击该卡取消选择。`
    : "点选一张卡片，再点击故事面板中的卡槽放入。";

  panel.append(tabs, grid, hint);
  return panel;
}

/** 渲染槽内已放置卡片的小芯片（含移除按钮）。 */
function createChip(kind, id, actIndex) {
  const card = cardIndex[kind].get(id);
  const chip = document.createElement("span");
  chip.className = "kongque-chip";

  const img = document.createElement("img");
  img.className = "kongque-chip__image";
  img.src = imageOf(card);
  img.alt = "";

  const text = document.createElement("span");
  text.className = "kongque-chip__text";
  text.textContent = `${id} ${card.name}`;

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "kongque-chip__remove";
  remove.dataset.remove = `${actIndex}:${kind}:${id}`;
  remove.setAttribute("aria-label", `移除 ${card.name}`);
  remove.textContent = "×";

  chip.append(img, text, remove);
  return chip;
}

/** 渲染单个卡槽；提交后按校验结果标注有效/无效。 */
function createSlot(actIndex, kind, act, check) {
  const slot = document.createElement("div");
  slot.className = `kongque-slot kongque-slot--${kind}`;
  slot.dataset.slot = `${actIndex}:${kind}`;

  const labelMap = { scene: "场景", character: "角色（1–3）", event: "事件" };
  const label = document.createElement("span");
  label.className = "kongque-slot__label";
  label.textContent = labelMap[kind];

  if (selected?.kind === kind) {
    slot.classList.add("is-accepting");
  }
  if (settledResult && check?.complete) {
    slot.classList.add(check.valid ? "is-valid" : "is-invalid");
  }

  if (kind === "scene" || kind === "event") {
    const id = kind === "scene" ? act.scene : act.event;
    if (id) {
      slot.classList.add("is-filled");
      slot.append(createChip(kind, id, actIndex));
    } else {
      const empty = document.createElement("span");
      empty.className = "kongque-slot__empty";
      empty.textContent = `点击放置${labelMap[kind]}`;
      slot.append(label, empty);
    }
    return slot;
  }

  // 角色槽：1–3 张
  act.characters.forEach((id) => slot.append(createChip("character", id, actIndex)));
  if (act.characters.length < 3) {
    const empty = document.createElement("span");
    empty.className = "kongque-slot__empty";
    empty.textContent = act.characters.length === 0 ? "点击放置角色" : "继续追加角色";
    slot.append(empty);
  }
  slot.prepend(label);
  return slot;
}

/** 渲染中栏：五幕故事面板。 */
function renderStage() {
  const section = document.createElement("section");
  section.className = "kongque-stage";

  arrangement.forEach((act, index) => {
    const actEl = document.createElement("article");
    actEl.className = "kongque-act";

    const heading = document.createElement("h3");
    heading.className = "kongque-act__title";
    const actDef = gameData.acts[index];
    heading.textContent = `第${["一", "二", "三", "四", "五"][index]}幕 · ${actDef.name}`;

    const check = settledResult?.actChecks[index] ?? null;
    const slots = document.createElement("div");
    slots.className = "kongque-act__slots";
    slots.append(
      createSlot(index, "scene", act, check),
      createSlot(index, "character", act, check),
      createSlot(index, "event", act, check),
    );

    actEl.append(heading, slots);
    section.append(actEl);
  });

  return section;
}

/** 渲染右栏某一幕的即时反馈：组合文本或柔性提示。 */
function createFeedback(check) {
  const feedback = document.createElement("p");
  feedback.className = "kongque-preview__feedback";

  if (!check.complete) {
    feedback.classList.add("is-pending");
    feedback.textContent = "本幕尚未放齐：每幕需要 1 个场景、1–3 名角色与 1 个事件。";
    return feedback;
  }

  if (check.valid) {
    feedback.classList.add("is-valid");
    feedback.textContent = check.combo ? check.combo.text : "组合成立，故事得以继续。";
    return feedback;
  }

  feedback.classList.add("is-warn");
  feedback.textContent = check.issue ?? "这一组卡片暂时无法成立。";
  return feedback;
}

/** 结算页信息小节：小标题 + 内容元素。 */
function resultSection(title, children) {
  const section = document.createElement("div");
  section.className = "kongque-result__section";
  const head = document.createElement("p");
  head.className = "kongque-result__sectiontitle";
  head.textContent = title;
  section.append(head, ...children);
  return section;
}

/** 结算页关键因果链：按发生顺序回放有效事件，自动追加的尾声事件单独标注。 */
function createCausalChain() {
  const validEvents = settledResult.actChecks
    .filter((check) => check.valid)
    .map((check) => arrangement[check.actIndex].event);
  // 尾声：状态中已发生、但不在玩家有效幕里的事件（如第 3 关 E14/E15 合葬化鸟）。
  const extras = [...settledResult.state.occurredEvents].filter(
    (id) => !validEvents.includes(id),
  );
  const items = [];
  if (validEvents.length > 0) {
    const line = document.createElement("p");
    line.className = "kongque-result__chain";
    line.textContent = validEvents.map(eventName).join(" → ");
    items.push(line);
  }
  if (extras.length > 0) {
    const epilogue = document.createElement("p");
    epilogue.className = "kongque-result__epilogue";
    epilogue.textContent = `尾声（自动追加）：${extras.map(eventName).join("、")}`;
    items.push(epilogue);
  }
  return items;
}

/** 结算页文化知识卡：本局出现的经典意象，配组合原文或事件说明（文字全部来自 JSON）。 */
function createCultureCards() {
  const occurred = settledResult.state.occurredEvents;
  return gameData.scoring.imagery
    .filter((item) => occurred.has(item.ref))
    .map((item) => {
      const combo = gameData.combos.find(
        (item2) => item2.event === item.ref && item2.source === "core",
      );
      const card = document.createElement("div");
      card.className = "kongque-culture";
      const name = document.createElement("p");
      name.className = "kongque-culture__name";
      name.textContent = `文化知识卡 · ${item.name}（${item.ref}）`;
      const text = document.createElement("p");
      text.className = "kongque-culture__text";
      text.textContent = combo?.text ?? cardIndex.event.get(item.ref)?.description ?? "";
      card.append(name, text);
      return card;
    });
}

/** 结算页“其他已满足结局”：条件同样成立、但按结算优先级未被采用的结局分支。 */
function createOtherEndings() {
  return satisfiedEndings(settledResult.score, settledResult.state)
    .filter((ending) => ending.id !== settledResult.ending?.id)
    .map((ending) => {
      const item = document.createElement("div");
      item.className = "kongque-result__other";
      const name = document.createElement("p");
      name.className = "kongque-result__other-name";
      name.textContent = ending.name;
      const text = document.createElement("p");
      text.className = "kongque-result__other-text";
      text.textContent = ending.text;
      item.append(name, text);
      return item;
    });
}

/** 结算页改写路线提示（第 4 关 routes 数据）：关键节点链与含义。 */
function createRouteHints() {
  return (currentLevel().routes ?? []).map((route) => {
    const item = document.createElement("div");
    item.className = "kongque-result__route";
    const name = document.createElement("p");
    name.className = "kongque-result__route-name";
    name.textContent = `${route.name}：${route.nodes}`;
    const meaning = document.createElement("p");
    meaning.className = "kongque-result__route-meaning";
    meaning.textContent = route.meaning;
    item.append(name, meaning);
    return item;
  });
}

/** 结算页“存入织梦卷轴”：命名保存本局编排与结局，供之后回放。 */
function createScrollSave() {
  const row = document.createElement("div");
  row.className = "kongque-scrollsave";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "kongque-input";
  input.dataset.scrollName = "";
  input.maxLength = 24;
  input.placeholder = `卷轴名：第${currentLevel().id}关·${
    settledResult.ending?.name ?? "未定结局"
  }`;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "kongque-scrollsave__button";
  button.dataset.saveScroll = "";
  button.textContent = "存入织梦卷轴";

  row.append(input, button);
  if (scrollNote) {
    const note = document.createElement("p");
    note.className = "kongque-scrollsave__note";
    note.textContent = scrollNote;
    row.append(note);
  }
  return row;
}

/** 渲染提交后的结算卡。 */
function createSettlement() {
  const box = document.createElement("div");
  box.className = "kongque-result";
  box.classList.add(settledResult.passed ? "is-pass" : "is-fail");

  const head = document.createElement("p");
  head.className = "kongque-result__head";
  head.textContent = settledResult.passed
    ? `通关 · ${"★".repeat(settledResult.stars)}${"☆".repeat(3 - settledResult.stars)}`
    : "故事尚未成形";
  box.append(head);

  if (settledResult.ending) {
    const ending = document.createElement("div");
    ending.className = "kongque-result__ending";
    const endingName = document.createElement("p");
    endingName.className = "kongque-result__ending-name";
    endingName.textContent = `结局：${settledResult.ending.name}${
      settledResult.ending.hidden ? "（隐藏结局）" : ""
    }`;
    const endingText = document.createElement("p");
    endingText.className = "kongque-result__ending-text";
    endingText.textContent = settledResult.ending.text;
    ending.append(endingName, endingText);
    box.append(ending);
  }

  // 关键因果链（策划书 9.8 体验项）：按发生顺序回放有效事件，尾声事件单独标注。
  const chainItems = createCausalChain();
  if (chainItems.length > 0) {
    box.append(resultSection("本局因果链", chainItems));
  }

  // 文化知识卡：本局出现的经典意象及原文出处。
  const cultureCards = createCultureCards();
  if (cultureCards.length > 0) {
    box.append(resultSection("文化知识卡", cultureCards));
  }

  // 其他已满足结局：除结算结局外同样达成的分支。
  const otherEndings = createOtherEndings();
  if (otherEndings.length > 0) {
    box.append(resultSection("其他已满足结局", otherEndings));
  }

  const score = settledResult.score;
  const dimensions = [
    ["完整度", score.completeness, gameData.scoring.dimensions.completeness],
    ["逻辑性", score.logic, gameData.scoring.dimensions.logic],
    ["主题契合", score.theme, gameData.scoring.dimensions.theme],
    ["文化还原", score.culture, gameData.scoring.dimensions.culture],
  ];
  dimensions.forEach(([name, value, max]) => {
    const row = document.createElement("div");
    row.className = "kongque-result__bar";
    const label = document.createElement("span");
    label.textContent = name;
    const track = document.createElement("span");
    track.className = "kongque-result__track";
    const fill = document.createElement("span");
    fill.className = "kongque-result__fill";
    fill.style.width = `${(value / max) * 100}%`;
    const num = document.createElement("span");
    num.className = "kongque-result__num";
    num.textContent = `${value}`;
    track.append(fill);
    row.append(label, track, num);
    box.append(row);
  });

  const total = document.createElement("p");
  total.className = "kongque-result__total";
  const rank = gameData.scoring.ranks.find(
    (item) => score.total >= item.min && score.total <= item.max,
  );
  total.textContent = `总分 ${score.total} · ${rank?.title ?? ""}`;
  box.append(total);

  const problems = settledResult.actChecks
    .filter((check) => check.complete && check.issue)
    .map((check) => `第${["一", "二", "三", "四", "五"][check.actIndex]}幕：${check.issue}`)
    .concat(settledResult.goalFailures);
  if (problems.length > 0) {
    const list = document.createElement("ul");
    list.className = "kongque-result__problems";
    problems.slice(0, 6).forEach((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      list.append(item);
    });
    box.append(list);
  }

  if (hintStage >= 3 && settledResult.stars <= 2) {
    const note = document.createElement("p");
    note.className = "kongque-result__hintnote";
    note.textContent = "本局使用过三级提示：按规则最高只能获得二星。";
    box.append(note);
  }

  // 三星挑战差距提示（策划书 9.2 规则4）：已通关但未满三星时，列出本关挑战未完成项。
  if (settledResult.passed && settledResult.stars < 3 && settledResult.starFailures.length > 0) {
    const challengeTitle = document.createElement("p");
    challengeTitle.className = "kongque-result__challenge-title";
    challengeTitle.textContent = "距三星挑战还差：";
    const challengeList = document.createElement("ul");
    challengeList.className = "kongque-result__challenge";
    settledResult.starFailures.forEach((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      challengeList.append(item);
    });
    box.append(challengeTitle, challengeList);
  }

  const tip = document.createElement("p");
  tip.className = "kongque-result__tip";
  tip.textContent = settledResult.passed
    ? "可以继续调整冲击更高星级，或切换下一关。"
    : "编排会保留，直接修改卡片后再次提交即可。";
  box.append(tip);

  // 改写路线提示（第 4 关数据）：帮助玩家探索其他结局分支。
  const routes = createRouteHints();
  if (routes.length > 0) {
    box.append(resultSection("改写路线", routes));
  }

  // 织梦卷轴：命名保存本局编排与结局，可在工具栏“织梦卷轴”中回放。
  box.append(createScrollSave());

  // 通关后可直达下一关（顺序解锁）。
  const next = gameData.levels.find((item) => item.id === currentLevel().id + 1);
  if (settledResult.passed && next) {
    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.className = "kongque-result__next";
    nextButton.dataset.nextLevel = String(next.id);
    nextButton.textContent = `进入第${next.id}关 · ${next.name}`;
    box.append(nextButton);
  }

  return box;
}

/** 渲染右栏：各幕编排概览、即时反馈与结算。 */
function renderPreview() {
  const aside = document.createElement("aside");
  aside.className = "kongque-preview";

  const heading = document.createElement("h3");
  heading.className = "kongque-preview__title";
  heading.textContent = "故事预览";
  aside.append(heading);

  const liveChecks = settledResult
    ? settledResult.actChecks
    : evaluateStory().actChecks; // 未提交时也给即时反馈，但不计分、不推进结局

  arrangement.forEach((act, index) => {
    const actDef = gameData.acts[index];
    const item = document.createElement("div");
    item.className = "kongque-preview__item";
    if (isActComplete(act)) {
      item.classList.add("is-complete");
    }

    const name = document.createElement("p");
    name.className = "kongque-preview__act";
    name.textContent = `第${["一", "二", "三", "四", "五"][index]}幕 · ${actDef.name}`;

    const detail = document.createElement("p");
    detail.className = "kongque-preview__detail";
    const parts = [];
    parts.push(act.scene ? cardIndex.scene.get(act.scene)?.name : "（缺场景）");
    parts.push(
      act.characters.length > 0
        ? act.characters.map((id) => cardIndex.character.get(id)?.name).join("、")
        : "（缺角色）",
    );
    parts.push(act.event ? cardIndex.event.get(act.event)?.name : "（缺事件）");
    detail.textContent = parts.join(" / ");

    item.append(name, detail, createFeedback(liveChecks[index]));
    aside.append(item);
  });

  if (settledResult) {
    aside.append(createSettlement());
  }

  return aside;
}

/** 渲染顶部工具栏：返回、关卡切换（含解锁状态）、提示与提交。 */
function renderToolbar() {
  const toolbar = document.createElement("div");
  toolbar.className = "kongque-toolbar";

  const levelPicker = document.createElement("label");
  levelPicker.className = "kongque-toolbar__picker";
  const pickerText = document.createElement("span");
  pickerText.textContent = "关卡";
  const select = document.createElement("select");
  select.dataset.levelSelect = "";
  gameData.levels.forEach((level) => {
    const option = document.createElement("option");
    option.value = String(level.id);
    // 顺序解锁：未通关前一关时，后续关卡不可选（策划书 8.5）。
    const locked = level.id > save.unlocked;
    option.disabled = locked;
    option.textContent = `第${level.id}关 · ${level.name}${locked ? "（未解锁）" : ""}`;
    if (level.id === levelId) {
      option.selected = true;
    }
    select.append(option);
  });
  levelPicker.append(pickerText, select);

  const level = currentLevel();
  const best = save.best[levelId];
  const goal = document.createElement("p");
  goal.className = "kongque-toolbar__goal";
  goal.textContent =
    `通关分 ${level.passScore}｜${level.positioning}` +
    (best ? `｜最佳：${"★".repeat(best.stars)}${"☆".repeat(3 - best.stars)} ${best.score}分` : "");

  const hintButton = document.createElement("button");
  hintButton.type = "button";
  hintButton.className = "kongque-toolbar__hint";
  hintButton.dataset.hint = "";
  hintButton.textContent = `提示 ${hintStage}/3`;
  hintButton.title = "一级指出问题幕；二级指出所需卡片或条件；三级高亮建议卡片（本关最高二星）";

  // 织梦卷轴与图鉴入口（策划书 9.8 体验项：命名存档回放 + 图鉴奖励）。
  const scrollsButton = document.createElement("button");
  scrollsButton.type = "button";
  scrollsButton.className = "kongque-toolbar__aux";
  scrollsButton.dataset.openScrolls = "";
  scrollsButton.textContent = `织梦卷轴${save.scrolls.length > 0 ? `（${save.scrolls.length}）` : ""}`;

  const codexButton = document.createElement("button");
  codexButton.type = "button";
  codexButton.className = "kongque-toolbar__aux";
  codexButton.dataset.openCodex = "";
  codexButton.textContent = "图鉴";

  const allComplete = arrangement.every(isActComplete);
  const submit = document.createElement("button");
  submit.type = "button";
  submit.className = "kongque-toolbar__submit";
  submit.dataset.submit = "";
  submit.disabled = !allComplete;
  submit.textContent = "提交编排";
  if (!allComplete) {
    submit.title = "需先把每一幕的场景、角色与事件放齐";
  }

  toolbar.append(levelPicker, goal, hintButton, scrollsButton, codexButton, submit);

  if (hintText) {
    const hintLine = document.createElement("p");
    hintLine.className = "kongque-toolbar__hinttext";
    hintLine.textContent = hintText;
    toolbar.append(hintLine);
  }

  return toolbar;
}

/** 渲染第 5 关随机命题横幅（策划书 9.6：随机命题 + 一次更换机会）。 */
function createThemeBanner() {
  if (!theme) {
    return null;
  }
  const box = document.createElement("div");
  box.className = "kongque-theme";

  const name = document.createElement("p");
  name.className = "kongque-theme__name";
  name.textContent = `本关命题：${theme.name}`;
  box.append(name);

  const parts = [];
  if (theme.tags?.length > 0) {
    parts.push(`主题标签：${theme.tags.join("、")}`);
  }
  if (Array.isArray(theme.cooccur) && theme.cooccur.length > 0) {
    parts.push(
      `「${theme.cooccur.map((id) => cardIndex.character.get(id)?.name ?? id).join("」「")}」需在 ${theme.cooccurMinActs ?? 1} 幕同台`,
    );
  }
  if (typeof theme.minConflictCharacters === "number") {
    parts.push(`冲突角色不少于 ${theme.minConflictCharacters} 人`);
  }
  if (theme.finalActLedBy) {
    parts.push(`终幕由「${cardIndex.character.get(theme.finalActLedBy)?.name ?? theme.finalActLedBy}」主导`);
  }
  if (Array.isArray(theme.characterArc) && theme.characterArc.length > 0) {
    parts.push(
      `${theme.characterArc.map((id) => cardIndex.character.get(id)?.name ?? id).join("、")}需在两幕中形成成长线`,
    );
  }
  if (Array.isArray(theme.mustIncludeCharacters) && theme.mustIncludeCharacters.length > 0) {
    parts.push(
      `必须出现：${theme.mustIncludeCharacters.map((id) => cardIndex.character.get(id)?.name ?? id).join("、")}`,
    );
  }
  if (Array.isArray(theme.marks) && theme.marks.length > 0) {
    parts.push(
      `需达成：${theme.marks.map((id) => gameData.marks.find((mark) => mark.id === id)?.name ?? id).join("、")}`,
    );
  }
  if (Array.isArray(theme.forbiddenEvents) && theme.forbiddenEvents.length > 0) {
    parts.push(`禁用事件：${theme.forbiddenEvents.map((id) => cardIndex.event.get(id)?.name ?? id).join("、")}`);
  }
  if (theme.finalScene) {
    parts.push(`终幕场景：${cardIndex.scene.get(theme.finalScene)?.name ?? theme.finalScene}`);
  }

  const req = document.createElement("p");
  req.className = "kongque-theme__req";
  req.textContent = parts.length > 0 ? `${parts.join("；")}。` : "按命题组织你的五幕故事。";
  box.append(req);

  const maxRerolls = currentLevel().rerolls ?? 0;
  if (maxRerolls > 0) {
    const reroll = document.createElement("button");
    reroll.type = "button";
    reroll.className = "kongque-theme__reroll";
    reroll.dataset.reroll = "";
    reroll.disabled = rerollsLeft <= 0;
    reroll.textContent = rerollsLeft > 0 ? `更换命题（剩 ${rerollsLeft} 次）` : "更换机会已用完";
    box.append(reroll);
  }

  return box;
}

/** 教学步骤目标是否已达成（goal 结构见 kongque-cards.json tutorial[].goal）。 */
function tutorialGoalMet(goal) {
  if (!goal || typeof goal !== "object") {
    return true; // 无目标的步骤视为纯说明，展示后即完成
  }
  if (goal.submitted) {
    return tutorialSubmitted;
  }
  if (typeof goal.actsComplete === "number" && arrangement.filter(isActComplete).length < goal.actsComplete) {
    return false;
  }
  if (typeof goal.act === "number") {
    const act = arrangement[goal.act - 1];
    if (!act || !isActComplete(act)) {
      return false;
    }
    if ((goal.characters ?? []).some((id) => !act.characters.includes(id))) {
      return false;
    }
    if ((goal.events ?? []).some((id) => act.event !== id)) {
      return false;
    }
  }
  return true;
}

/** 推进教学步骤：目标已达成则前移（每次重绘前调用），进度随草稿保存。 */
function advanceTutorial() {
  const steps = currentLevel().tutorial ?? [];
  const before = tutorialStep;
  while (tutorialStep < steps.length && tutorialGoalMet(steps[tutorialStep].goal)) {
    tutorialStep += 1;
  }
  if (tutorialStep !== before) {
    persistDraft();
  }
}

/** 渲染教学分步引导横幅（策划书 9.3 教学关）：当前步骤文案 + 进度点。 */
function createTutorial() {
  const steps = currentLevel().tutorial ?? [];
  if (steps.length === 0 || tutorialStep >= steps.length) {
    return null;
  }
  const box = document.createElement("div");
  box.className = "kongque-tutorial";

  const label = document.createElement("p");
  label.className = "kongque-tutorial__label";
  label.textContent = `教学引导 ${tutorialStep + 1}/${steps.length}`;
  box.append(label);

  const text = document.createElement("p");
  text.className = "kongque-tutorial__text";
  text.textContent = steps[tutorialStep].text;
  box.append(text);

  const dots = document.createElement("div");
  dots.className = "kongque-tutorial__dots";
  steps.forEach((_, index) => {
    const dot = document.createElement("span");
    dot.className = "kongque-tutorial__dot";
    if (index < tutorialStep) {
      dot.classList.add("is-done");
    } else if (index === tutorialStep) {
      dot.classList.add("is-current");
    }
    dots.append(dot);
  });
  box.append(dots);
  return box;
}

/** 把当前已结算的故事存为织梦卷轴（策划书“织梦卷轴命名存档”体验项）。 */
function saveScroll(name) {
  if (!settledResult) {
    return;
  }
  const level = currentLevel();
  save.scrolls.push({
    id: `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: (name ?? "").trim() || `第${level.id}关·${settledResult.ending?.name ?? "未定结局"}`,
    levelId: level.id,
    levelName: level.name,
    themeName: theme?.name ?? null,
    time: Date.now(),
    acts: arrangement.map((act) => ({
      scene: act.scene,
      characters: [...act.characters],
      event: act.event,
    })),
    endingId: settledResult.ending?.id ?? null,
    result: { score: settledResult.score.total, stars: settledResult.stars },
  });
  scrollNote = "已存入织梦卷轴，可在顶部“织梦卷轴”中回放。";
  persistSave();
}

/** 织梦卷轴列表：每卷显示成绩与结局，可回放或删除。 */
function buildScrollsBody() {
  if (save.scrolls.length === 0) {
    const empty = document.createElement("p");
    empty.className = "kongque-modal__empty";
    empty.textContent =
      "尚未保存任何卷轴。提交编排后，可在结算页将本局故事命名存入织梦卷轴。";
    return [empty];
  }
  return [...save.scrolls]
    .sort((a, b) => b.time - a.time)
    .map((scroll) => {
      const item = document.createElement("div");
      item.className = "kongque-modal__item";

      const name = document.createElement("p");
      name.className = "kongque-modal__item-name";
      name.textContent = scroll.name;

      const ending = gameData.endings.find((item2) => item2.id === scroll.endingId);
      const meta = document.createElement("p");
      meta.className = "kongque-modal__item-meta";
      meta.textContent = [
        `第${scroll.levelId}关 · ${scroll.levelName}`,
        scroll.themeName ? `命题「${scroll.themeName}」` : null,
        scroll.result?.stars != null
          ? `${"★".repeat(scroll.result.stars)}${"☆".repeat(3 - scroll.result.stars)} ${scroll.result.score}分`
          : null,
        ending ? `结局：${ending.name}` : null,
      ]
        .filter(Boolean)
        .join("｜");

      const actions = document.createElement("div");
      actions.className = "kongque-modal__actions";
      const replayButton = document.createElement("button");
      replayButton.type = "button";
      replayButton.className = "kongque-modal__button is-primary";
      replayButton.dataset.replayScroll = scroll.id;
      replayButton.textContent = "回放";
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "kongque-modal__button is-secondary";
      deleteButton.dataset.deleteScroll = scroll.id;
      deleteButton.textContent = "删除";
      actions.append(replayButton, deleteButton);

      item.append(name, meta, actions);
      return item;
    });
}

/** 图鉴：按关卡展示已解锁奖励（未通关显示？？？），并列出结局收集进度。 */
function buildCodexBody() {
  const body = [];

  const intro = document.createElement("p");
  intro.className = "kongque-modal__intro";
  intro.textContent = "通关对应关卡即可点亮图鉴条目。";
  body.push(intro);

  gameData.levels.forEach((level) => {
    const rewards = level.rewards ?? {};
    const passed = Boolean(save.best[level.id]);
    const section = document.createElement("div");
    section.className = "kongque-codex";

    const title = document.createElement("p");
    title.className = "kongque-codex__title";
    title.textContent = `第${level.id}关 · ${level.name}${passed ? "" : "（未解锁）"}`;
    section.append(title);

    const entries = document.createElement("div");
    entries.className = "kongque-codex__entries";
    const codexList = passed ? rewards.codex ?? [] : (rewards.codex ?? []).map(() => "？？？");
    codexList.forEach((text) => {
      const entry = document.createElement("span");
      entry.className = `kongque-codex__entry${passed ? "" : " is-locked"}`;
      entry.textContent = text;
      entries.append(entry);
    });
    if (passed) {
      (rewards.marks ?? []).forEach((id) => {
        const mark = gameData.marks.find((item) => item.id === id);
        const entry = document.createElement("span");
        entry.className = "kongque-codex__entry";
        entry.textContent = `印记 · ${mark?.name ?? id}`;
        entries.append(entry);
      });
      (rewards.other ?? []).forEach((text) => {
        const entry = document.createElement("span");
        entry.className = "kongque-codex__entry";
        entry.textContent = text;
        entries.append(entry);
      });
    }
    section.append(entries);
    body.push(section);
  });

  // 结局收集：取各关最佳成绩中记录的结局 id。
  const achieved = new Set(
    Object.values(save.best)
      .map((best) => best.ending)
      .filter(Boolean),
  );
  const endingsSection = document.createElement("div");
  endingsSection.className = "kongque-codex";
  const endingsTitle = document.createElement("p");
  endingsTitle.className = "kongque-codex__title";
  endingsTitle.textContent = `结局收集（${achieved.size}/${gameData.endings.length}）`;
  endingsSection.append(endingsTitle);
  const endingsList = document.createElement("div");
  endingsList.className = "kongque-codex__entries";
  gameData.endings.forEach((ending) => {
    const entry = document.createElement("span");
    const got = achieved.has(ending.id);
    entry.className = `kongque-codex__entry${got ? "" : " is-locked"}`;
    entry.textContent = got ? ending.name : "？？？";
    entry.title = got ? ending.text : "尚未达成";
    endingsList.append(entry);
  });
  endingsSection.append(endingsList);
  body.push(endingsSection);
  return body;
}

/** 卷轴回放：按幕重述存入时的故事（文本全部取自 JSON 数据）。 */
function buildReplayBody(scroll) {
  const level = gameData.levels.find((item) => item.id === scroll.levelId);
  const body = [];

  // 依存入时的事件重算自动追加的尾声（与 evaluateStory 同规则）。
  const occurred = new Set(scroll.acts.map((act) => act.event).filter(Boolean));
  const epilogue = [];
  (level?.autoAppend ?? []).forEach((rule) => {
    if (rule.after.every((id) => occurred.has(id))) {
      rule.events.forEach((id) => {
        if (!occurred.has(id)) {
          occurred.add(id);
          epilogue.push(id);
        }
      });
    }
  });

  const actNo = (index) => `第${["一", "二", "三", "四", "五"][index] ?? index + 1}幕`;
  scroll.acts.forEach((act, index) => {
    const row = document.createElement("div");
    row.className = "kongque-replay__act";
    const head = document.createElement("p");
    head.className = "kongque-replay__head";
    head.textContent = [
      `${actNo(index)} · ${gameData.acts[index]?.name ?? ""}`,
      act.scene ? cardIndex.scene.get(act.scene)?.name : "",
      act.characters.map((id) => cardIndex.character.get(id)?.name ?? id).join("、"),
      act.event ? cardIndex.event.get(act.event)?.name : "",
    ]
      .filter(Boolean)
      .join("／");
    row.append(head);
    if (act.event) {
      const combo = findCombo(act);
      const text = document.createElement("p");
      text.className = "kongque-replay__text";
      text.textContent = combo?.text ?? cardIndex.event.get(act.event)?.description ?? "";
      row.append(text);
    }
    body.push(row);
  });

  epilogue.forEach((id) => {
    const event = cardIndex.event.get(id);
    const row = document.createElement("div");
    row.className = "kongque-replay__act";
    const head = document.createElement("p");
    head.className = "kongque-replay__head";
    head.textContent = `尾声 · ${event?.name ?? id}`;
    const text = document.createElement("p");
    text.className = "kongque-replay__text";
    text.textContent = event?.description ?? "";
    row.append(head, text);
    body.push(row);
  });

  const ending = gameData.endings.find((item) => item.id === scroll.endingId);
  if (ending) {
    const row = document.createElement("div");
    row.className = "kongque-replay__act is-ending";
    const head = document.createElement("p");
    head.className = "kongque-replay__head";
    head.textContent = `结局 · ${ending.name}${ending.hidden ? "（隐藏结局）" : ""}`;
    const text = document.createElement("p");
    text.className = "kongque-replay__text";
    text.textContent = ending.text;
    row.append(head, text);
    body.push(row);
  }
  return body;
}

/** 渲染模态框：织梦卷轴列表 / 图鉴 / 卷轴回放。 */
function renderModal() {
  if (!modalOpen) {
    return null;
  }
  const overlay = document.createElement("div");
  overlay.className = "kongque-modal";
  overlay.dataset.modal = "";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  const dialog = document.createElement("div");
  dialog.className = "kongque-modal__dialog kongque-modal__dialog--wide";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "kongque-modal__close";
  close.dataset.closeModal = "";
  close.setAttribute("aria-label", "关闭");
  close.textContent = "×";

  let title = "";
  let body = [];
  if (modalOpen === "scrolls") {
    title = "织梦卷轴";
    body = buildScrollsBody();
  } else if (modalOpen === "codex") {
    title = "图鉴";
    body = buildCodexBody();
  } else if (modalOpen === "replay") {
    const scroll = save.scrolls.find((item) => item.id === replayScrollId);
    if (scroll) {
      title = `回放 · ${scroll.name}`;
      body = buildReplayBody(scroll);
    } else {
      // 卷轴已被删除等异常：回退到列表。
      modalOpen = "scrolls";
      title = "织梦卷轴";
      body = buildScrollsBody();
    }
  }

  const head = document.createElement("p");
  head.className = "kongque-modal__title";
  head.textContent = title;

  const content = document.createElement("div");
  content.className = "kongque-modal__body";
  content.append(...body);

  dialog.append(close, head, content);
  overlay.append(dialog);
  return overlay;
}

/** 依据当前状态重绘整个游戏区。 */
function renderBoard() {
  const board = mountedContainer.querySelector(".kongque-game");
  if (!board) {
    return;
  }
  advanceTutorial();
  const themeBanner = createThemeBanner();
  const tutorialBanner = createTutorial();
  board.replaceChildren(
    renderToolbar(),
    ...(tutorialBanner ? [tutorialBanner] : []),
    ...(themeBanner ? [themeBanner] : []),
    renderLibrary(),
    renderStage(),
    renderPreview(),
  );
  renderContentWarning();
  // 模态框挂在 .kongque-board 上（在 .kongque-game 之外），
  // 重绘不会清掉它，因此先移除旧模态框再按当前状态重建。
  mountedContainer.querySelector(".kongque-board")?.querySelector("[data-modal]")?.remove();
  const modal = renderModal();
  if (modal) {
    mountedContainer.querySelector(".kongque-board")?.append(modal);
  }
}

/**
 * 第 3 关殉情内容警告遮罩（策划书 9.5／验收6）：
 * 进入关卡即提示后续包含文学作品中的殉情情节；可继续或返回上一关。
 */
function renderContentWarning() {
  if (contentWarningAcked || levelId !== 3) {
    return;
  }
  const board = mountedContainer.querySelector(".kongque-board");
  if (!board || board.querySelector("[data-content-warning]")) {
    return;
  }
  const overlay = document.createElement("div");
  overlay.className = "kongque-modal";
  overlay.dataset.contentWarning = "";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  const dialog = document.createElement("div");
  dialog.className = "kongque-modal__dialog";

  const title = document.createElement("p");
  title.className = "kongque-modal__title";
  title.textContent = "内容提示";

  const text = document.createElement("p");
  text.className = "kongque-modal__text";
  text.textContent =
    "本关后续包含文学原作《孔雀东南飞》中的殉情情节。相关画面仅用水波、绣鞋与树影作象征性表达，不直接展示伤害过程。";

  const actions = document.createElement("div");
  actions.className = "kongque-modal__actions";

  const back = document.createElement("button");
  back.type = "button";
  back.className = "kongque-modal__button is-secondary";
  back.dataset.warningBack = "";
  back.textContent = "返回上一关";

  const continueButton = document.createElement("button");
  continueButton.type = "button";
  continueButton.className = "kongque-modal__button is-primary";
  continueButton.dataset.warningContinue = "";
  continueButton.textContent = "继续编排";

  actions.append(back, continueButton);
  dialog.append(title, text, actions);
  overlay.append(dialog);
  board.append(overlay);
}

/** 处理游戏区内的点击（事件委托，README 建议③：统一受 AbortController 管理）。 */
function handleClick(event) {
  const warningContinue = event.target.closest("[data-warning-continue]");
  if (warningContinue) {
    contentWarningAcked = true;
    mountedContainer.querySelector("[data-content-warning]")?.remove();
    return;
  }

  const warningBack = event.target.closest("[data-warning-back]");
  if (warningBack) {
    switchLevel(Math.max(1, levelId - 1));
    renderBoard();
    return;
  }

  const tab = event.target.closest("[data-tab]");
  if (tab) {
    activeTab = tab.dataset.tab;
    renderBoard();
    return;
  }

  const hint = event.target.closest("[data-hint]");
  if (hint) {
    hintStage = Math.min(hintStage + 1, 3);
    hintText = buildHint();
    renderBoard();
    return;
  }

  const reroll = event.target.closest("[data-reroll]");
  if (reroll && rerollsLeft > 0) {
    rollTheme();
    rerollsLeft -= 1;
    settledResult = null; // 命题变化后旧结算失效
    persistDraft();
    renderBoard();
    return;
  }

  const nextLevel = event.target.closest("[data-next-level]");
  if (nextLevel) {
    switchLevel(Number(nextLevel.dataset.nextLevel));
    renderBoard();
    return;
  }

  const submit = event.target.closest("[data-submit]");
  if (submit) {
    settledResult = evaluateStory();
    tutorialSubmitted = true; // 教学步骤 submitted 目标
    if (settledResult.passed) {
      recordResult(settledResult); // 解锁下一关并保存最佳成绩
    }
    renderBoard();
    return;
  }

  const openScrolls = event.target.closest("[data-open-scrolls]");
  if (openScrolls) {
    modalOpen = "scrolls";
    renderBoard();
    return;
  }

  const openCodex = event.target.closest("[data-open-codex]");
  if (openCodex) {
    modalOpen = "codex";
    renderBoard();
    return;
  }

  const closeModal = event.target.closest("[data-close-modal]");
  if (closeModal) {
    modalOpen = null;
    renderBoard();
    return;
  }

  const replayButton = event.target.closest("[data-replay-scroll]");
  if (replayButton) {
    replayScrollId = replayButton.dataset.replayScroll;
    modalOpen = "replay";
    renderBoard();
    return;
  }

  const deleteButton = event.target.closest("[data-delete-scroll]");
  if (deleteButton) {
    save.scrolls = save.scrolls.filter((item) => item.id !== deleteButton.dataset.deleteScroll);
    persistSave();
    renderBoard();
    return;
  }

  const saveScrollButton = event.target.closest("[data-save-scroll]");
  if (saveScrollButton) {
    const input = mountedContainer.querySelector("[data-scroll-name]");
    saveScroll(input?.value ?? "");
    renderBoard();
    return;
  }

  const pick = event.target.closest("[data-pick]");
  if (pick) {
    const [kind, id] = pick.dataset.pick.split(":");
    selected = selected?.kind === kind && selected.id === id ? null : { kind, id };
    renderBoard();
    return;
  }

  const remove = event.target.closest("[data-remove]");
  if (remove) {
    const [actIndex, kind, id] = remove.dataset.remove.split(":");
    removeCard(Number(actIndex), kind, id);
    renderBoard();
    return;
  }

  const slot = event.target.closest("[data-slot]");
  if (slot && selected) {
    const [actIndex, kind] = slot.dataset.slot.split(":");
    if (CARD_KINDS.includes(kind) && selected.kind === kind) {
      placeCard(Number(actIndex), kind, selected.id);
      renderBoard();
    }
  }
}

/** 处理关卡下拉切换。 */
function handleChange(event) {
  const select = event.target.closest("[data-level-select]");
  if (select) {
    switchLevel(Number(select.value));
    renderBoard();
  }
}

/** 孔雀东南飞游戏模块。 */
export default defineGameModule({
  id: "kongque",
  name: "孔雀东南飞",

  async init(container, config = {}) {
    this.destroy(); // 保证 init 可重复调用，并先清理上一轮状态
    mountedContainer = container;
    eventController = new AbortController();
    disposed = false;

    container.innerHTML = `
      <div class="kongque-board">
        <p class="kongque-loading">卡卷展开中……</p>
      </div>
    `;

    let data;
    try {
      data = await loadCards();
    } catch (error) {
      console.error(error);
      if (!disposed) {
        container.innerHTML = `
          <div class="kongque-board">
            <p class="kongque-error" role="alert">卡卷载入失败，请返回故事卷后重试。</p>
          </div>
        `;
      }
      return;
    }

    // 数据返回前用户已离开：不再操作容器（README 建议④的清理精神）。
    if (disposed) {
      return;
    }

    gameData = data;
    cardIndex = buildIndex(data);
    save = loadSave();

    // 恢复进度：回到上次游玩且已解锁的关卡（含草稿与命题）。
    const maxLevel = gameData.levels.length;
    const lastLevel = Math.min(Math.max(save.lastLevel, 1), Math.min(save.unlocked, maxLevel));
    switchLevel(lastLevel);

    container.replaceChildren();

    const board = document.createElement("div");
    board.className = "kongque-board";

    const header = document.createElement("header");
    header.className = "kongque-board__header";

    const title = document.createElement("h2");
    title.className = "kongque-board__title";
    title.textContent = data.gameName;

    const backButton = document.createElement("button");
    backButton.type = "button";
    backButton.className = "kongque-board__back";
    backButton.textContent = "← 返回故事卷";
    backButton.addEventListener(
      "click",
      () => config.navigate?.("home"),
      { signal: eventController.signal },
    );

    header.append(title, backButton);

    const game = document.createElement("div");
    game.className = "kongque-game";

    board.append(header, game);
    container.append(board);

    // 事件委托：一次绑定覆盖后续全部重绘。
    board.addEventListener("click", handleClick, { signal: eventController.signal });
    board.addEventListener("change", handleChange, { signal: eventController.signal });

    renderBoard();
  },

  destroy() {
    disposed = true;
    eventController?.abort(); // 一句话撤销所有使用 signal 注册的监听器
    eventController = null;

    // 释放模块内游戏状态，避免下次进入时残留（README 建议⑤）。
    gameData = null;
    cardIndex = null;
    selected = null;
    arrangement = [];
    settledResult = null;
    save = { unlocked: 1, best: {}, drafts: {}, lastLevel: 1, scrolls: [] };
    hintStage = 0;
    hintCards = new Set();
    hintText = "";
    theme = null;
    rerollsLeft = 0;
    tutorialStep = 0;
    tutorialSubmitted = false;
    modalOpen = null;
    replayScrollId = null;
    scrollNote = "";

    if (mountedContainer) {
      mountedContainer.replaceChildren();
      mountedContainer = null;
    }
  },
});
