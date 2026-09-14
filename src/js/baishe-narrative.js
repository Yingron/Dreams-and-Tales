(function () {
"use strict";

/**
 * 白蛇传叙事引擎。
 *
 * 纯逻辑、无 DOM 依赖，便于单元测试：场景角色模板、文本生成、路径匹配、
 * 柔性提示、四维评分与结局推导。
 *
 * 角色槽位语义（与《卡片编号》文档一致）：槽 1 = A、槽 2 = B、槽 3 = C。
 *   S1: A 撑伞递向 B      S2: A 目击、B 现形    S3: A 独赴昆仑盗草
 *   S4: A 施法、B 对峙    S5: A 拔剑、B 被指、C 阻拦
 *   S6: A 塔外凝望、B 塔内被囚
 */

const SCENE_IDS = Object.freeze(["S1", "S2", "S3", "S4", "S5", "S6"]);
const CHARACTER_IDS = Object.freeze(["C1", "C2", "C3", "C4"]);
const CLASSIC_ORDER = Object.freeze(["S1", "S2", "S3", "S4", "S5", "S6"]);
const ROW_COUNT = 6;

/** 每个场景下三个角色槽位的顺序语义标签（空字符串表示该槽不承担独立角色）。 */
const SCENE_ROLES = Object.freeze({
  S1: ["撑伞者", "接伞者", ""],
  S2: ["目击者", "现形者", ""],
  S3: ["盗草者", "", ""],
  S4: ["施法者", "对峙者", ""],
  S5: ["拔剑者", "被指者", "阻拦者"],
  S6: ["凝望者", "被囚者", ""],
});

// ---------------------------------------------------------------------------
// 基础状态
// ---------------------------------------------------------------------------

/** 新建空台面：六幕固定行，每行一个场景槽与三个角色槽。 */
function createEmptyState() {
  return {
    scenes: Array.from({ length: ROW_COUNT }, () => ({
      sceneId: null,
      slots: [[], [], []],
    })),
  };
}

/** 把已验证路径的场景数据转换成台面状态（用于预填与测试）。 */
function storyToState(story) {
  const state = createEmptyState();
  story.scenes.forEach((entry, index) => {
    state.scenes[index].sceneId = entry.scene;
    entry.slots.forEach((slot, slotIndex) => {
      if (slotIndex < 3) {
        state.scenes[index].slots[slotIndex] = [...slot];
      }
    });
  });
  return state;
}

function cloneState(state) {
  return {
    scenes: state.scenes.map((row) => ({
      sceneId: row.sceneId,
      slots: row.slots.map((slot) => [...slot]),
    })),
  };
}

/**
 * 随机生成一个六幕编排（「随手一编」）：
 * 六个场景全排列（不重复），每幕随机 1–3 名不重复角色，
 * 并保证四名角色全部至少出场一次。
 * @param {() => number} [rng] 随机数函数，默认 Math.random，便于测试注入。
 */
function createRandomState(rng = Math.random) {
  const state = createEmptyState();

  const sceneOrder = [...SCENE_IDS];
  for (let i = sceneOrder.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [sceneOrder[i], sceneOrder[j]] = [sceneOrder[j], sceneOrder[i]];
  }

  const charOrder = [...CHARACTER_IDS];
  for (let i = charOrder.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [charOrder[i], charOrder[j]] = [charOrder[j], charOrder[i]];
  }

  sceneOrder.forEach((sceneId, rowIndex) => {
    state.scenes[rowIndex].sceneId = sceneId;
    const chosen = [];
    // 前四幕各保底一名不同角色，保证四名角色全部出场。
    if (rowIndex < CHARACTER_IDS.length) {
      chosen.push(charOrder[rowIndex]);
    }
    // 再补 0–2 名随机角色；尚无角色的幕保底 1–2 名。
    let extras = Math.floor(rng() * 3);
    if (chosen.length === 0) {
      extras = 1 + Math.floor(rng() * 2);
    }
    for (let k = 0; k < extras; k += 1) {
      const candidate = CHARACTER_IDS[Math.floor(rng() * CHARACTER_IDS.length)];
      if (!chosen.includes(candidate)) chosen.push(candidate);
    }
    chosen.forEach((charId, slotIndex) => {
      state.scenes[rowIndex].slots[slotIndex].push(charId);
    });
  });

  return state;
}

// ---------------------------------------------------------------------------
// 卡片查询辅助
// ---------------------------------------------------------------------------

const sceneNameOf = (cards, id) => cards.scenes.find((s) => s.id === id)?.name ?? id;
const sceneImageOf = (cards, id) => cards.scenes.find((s) => s.id === id)?.image ?? "";
const charNameOf = (cards, id) => cards.characters.find((c) => c.id === id)?.name ?? id;
const charImageOf = (cards, id) => cards.characters.find((c) => c.id === id)?.image ?? "";
const joinNames = (ids, cards) => ids.map((id) => charNameOf(cards, id)).join("、");

// ---------------------------------------------------------------------------
// 即时叙事生成
// ---------------------------------------------------------------------------

const namesOf = (slot, cards) => joinNames(slot, cards);

function s1Text(slots, cards) {
  const A = namesOf(slots[0], cards);
  const B = namesOf(slots[1], cards);
  const C = namesOf(slots[2], cards);
  if (!A && !B) return null;
  let text;
  if (A && B) {
    text = `清明雨日，${A}在西湖断桥边撑伞递向${B}，二人由此结缘。`;
  } else if (A) {
    text = `${A}独行至西湖断桥，雨中徘徊，似在等候什么人。`;
  } else {
    text = `${B}行至西湖断桥，烟雨之中驻足等候。`;
  }
  return C ? `${text}${C}在旁目睹了这一幕。` : text;
}

function s2Text(slots, cards) {
  const A = namesOf(slots[0], cards);
  const B = namesOf(slots[1], cards);
  const C = namesOf(slots[2], cards);
  if (!A && !B) return null;
  let text;
  if (A && B) {
    text = `端午夜，${B}饮下雄黄酒现出原形，${A}撞见床帐中巨蛇之影，惊恐后退。`;
  } else if (B) {
    text = `端午夜，${B}饮下雄黄酒，卧房中现出原形，无人察觉。`;
  } else {
    text = `端午夜，${A}听见房内异响，徘徊门外，终未推门。`;
  }
  return C ? `${text}${C}躲在窗外目睹了这一切。` : text;
}

function s3Text(slots, cards) {
  const joined = namesOf(slots.flat(), cards);
  if (!joined) return null;
  return `${joined}赴昆仑仙境，持剑与仙鹤童子激战，夺得灵芝。`;
}

function s4Text(slots, cards) {
  const A = namesOf(slots[0], cards);
  const B = namesOf(slots[1], cards);
  const C = namesOf(slots[2], cards);
  if (!A && !B) return null;
  let text;
  if (A && B) {
    text = `${A}立于浪尖施法，水漫金山寺，${B}立于寺前与之对峙。`;
  } else if (A) {
    text = `${A}立于浪尖施法，水漫金山寺，浪涌高过佛殿屋顶。`;
  } else {
    text = `金山寺前，${B}严阵以待。`;
  }
  return C ? `${text}${C}在旁周旋。` : text;
}

function s5Text(slots, cards) {
  const A = namesOf(slots[0], cards);
  const B = namesOf(slots[1], cards);
  const C = namesOf(slots[2], cards);
  if (!A && !B && !C) return null;
  if (A && B && C) return `断桥之上，${A}拔剑指向${B}，${C}挡在中间伸手阻拦。`;
  if (A && B) return `断桥之上，${A}拔剑指向${B}。`;
  if (A && C) return `断桥之上，${A}拔剑相向，${C}伸手阻拦。`;
  if (A) return `${A}在断桥之上持剑而立。`;
  if (B) return `${B}行至断桥，心事重重。`;
  return `${C}在断桥上等候来者。`;
}

function s6Text(slots, cards) {
  const A = namesOf(slots[0], cards);
  const B = namesOf(slots[1], cards);
  const C = namesOf(slots[2], cards);
  if (!A && !B) return null;
  let text;
  if (A && B) {
    text = `${B}被镇压于雷峰塔下，${A}立于塔外凝望，永世分离。`;
  } else if (B) {
    text = `雷峰塔门紧闭，${B}被囚于塔内。`;
  } else {
    text = `${A}立于雷峰塔外，凝望紧闭的塔门。`;
  }
  return C ? `${text}${C}亦在塔外。` : text;
}

const SCENE_TEXT = Object.freeze({
  S1: s1Text,
  S2: s2Text,
  S3: s3Text,
  S4: s4Text,
  S5: s5Text,
  S6: s6Text,
});

/** 按槽位顺序语义生成单场叙事文本；无角色时返回 null。 */
function renderSceneText(sceneId, slots, cards) {
  const template = SCENE_TEXT[sceneId];
  return template ? template(slots, cards) : null;
}

/** 生成整台六幕的叙事文本序列。 */
function renderStoryTexts(state, cards) {
  return state.scenes.map((row) => ({
    sceneId: row.sceneId,
    text: row.sceneId ? renderSceneText(row.sceneId, row.slots, cards) : null,
  }));
}

// ---------------------------------------------------------------------------
// 已验证路径匹配
// ---------------------------------------------------------------------------

const sortedKey = (ids) => [...ids].sort().join(",");

/**
 * 判定台面是否与某条已验证路径完全一致：
 * 场景序列相等，且每个角色槽位的角色集合相等（槽内顺序不敏感）。
 */
function matchStoryPath(state, stories) {
  return (
    stories.find((story) =>
      story.scenes.every((entry, index) => {
        const row = state.scenes[index];
        if (row.sceneId !== entry.scene) return false;
        for (let slotIndex = 0; slotIndex < 3; slotIndex += 1) {
          const expected = entry.slots[slotIndex] ?? [];
          const actual = row.slots[slotIndex];
          if (expected.length !== actual.length) return false;
          if (sortedKey(expected) !== sortedKey(actual)) return false;
        }
        return true;
      })
    ) ?? null
  );
}

// ---------------------------------------------------------------------------
// 柔性提示（策划书 6.2）
// ---------------------------------------------------------------------------

/**
 * 计算当前排列的柔性提示。已验证路径视为逻辑自洽，不提示。
 * @returns {{level: 'warn'|'info', text: string}[]}
 */
function computeHints(state, cards, matchedStory) {
  if (matchedStory) return [];

  const rows = state.scenes;
  const sceneIds = rows.map((row) => row.sceneId).filter(Boolean);
  const nameOf = (id) => sceneNameOf(cards, id);
  const lastFilledIndex = rows.reduce((acc, row, index) => (row.sceneId ? index : acc), -1);
  const hints = [];

  const s1 = sceneIds.indexOf("S1");
  const s5 = sceneIds.indexOf("S5");
  if (s1 !== -1 && s5 !== -1 && s5 < s1) {
    hints.push({
      level: "warn",
      text: "断桥重逢在初遇之前——你想讲的是一个倒叙的故事吗？如果是有意为之，请在断桥重逢中安排能解释这个时序的角色关系。",
    });
  }

  if (sceneIds.includes("S6") && sceneIds.lastIndexOf("S6") !== lastFilledIndex) {
    hints.push({
      level: "warn",
      text: "雷峰塔已落，但故事还在继续。被镇压的人是否越狱了？还是这塔困住的是另一个人？后面的场景需要回应这个设定。",
    });
  }

  const counts = new Map();
  sceneIds.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
  const duplicated = [...counts.entries()].find(([, count]) => count > 1);
  if (duplicated) {
    hints.push({
      level: "warn",
      text: `你的故事中有两场${nameOf(duplicated[0])}。是否考虑用其他场景替换其中一场？每个场景都有独特的叙事功能。`,
    });
  }

  const missing = SCENE_IDS.filter((id) => !counts.has(id));
  if (missing.length > 0) {
    hints.push({
      level: "info",
      text: `六幕之中还缺少${missing.map(nameOf).join("、")}。完整的故事需要它们——试试把它们请回来？`,
    });
  }

  const usedChars = new Set(rows.flatMap((row) => row.slots.flat()));
  if (usedChars.size > 0 && !usedChars.has("C3") && !usedChars.has("C4")) {
    hints.push({
      level: "warn",
      text: "法海和小青一直在后台等待。缺少他们，水漫金山找不到对手，断桥重逢找不到拔剑之人。要不要试试让他们上场？",
    });
  }

  return hints;
}

// ---------------------------------------------------------------------------
// 四维评分（策划书 6.1）
// ---------------------------------------------------------------------------

const GRADE_TITLES = [
  [90, "千年织梦者"],
  [80, "传说编织者"],
  [70, "初入传说"],
  [50, "尚待续织"],
  [0, "散落的丝线"],
];

function gradeOf(total) {
  return GRADE_TITLES.find(([min]) => total >= min)[1];
}

/** 统计符合经典角色配置的项数（每项 1 分，最多 7 分）。 */
function countClassicConfig(rows) {
  const rowOf = (id) => rows.find((row) => row.sceneId === id);
  const has = (row, slotIndex, charId) => !!row && row.slots[slotIndex].includes(charId);
  let points = 0;
  if (has(rowOf("S1"), 0, "C2")) points += 1; // S1 递伞人 = 许仙
  if (has(rowOf("S2"), 1, "C1")) points += 1; // S2 现形者 = 白素贞
  if (has(rowOf("S3"), 0, "C1")) points += 1; // S3 盗草者 = 白素贞
  if (has(rowOf("S4"), 0, "C1")) points += 1; // S4 施法者 = 白素贞
  if (has(rowOf("S4"), 1, "C3")) points += 1; // S4 对峙者 = 法海
  if (has(rowOf("S5"), 2, "C1")) points += 1; // S5 阻拦者 = 白素贞
  if (has(rowOf("S6"), 1, "C1")) points += 1; // S6 被囚者 = 白素贞
  return points;
}

const emptyScore = () => ({
  completeness: 0,
  coherence: 0,
  theme: 0,
  culture: 0,
  bonus: 0,
  total: 0,
  grade: gradeOf(0),
});

/**
 * 四维评分：情节完整度 / 逻辑连贯度 / 主题契合度 / 文化还原度，各 25 分。
 * 匹配已验证路径额外 +15 且保底 85 分。
 */
function computeScore(state, matchedStory) {
  const rows = state.scenes;
  const usedRows = rows.filter((row) => row.sceneId);
  if (usedRows.length === 0) return emptyScore();

  const sceneIds = usedRows.map((row) => row.sceneId);
  const uniqueCount = new Set(sceneIds).size;
  const charRows = usedRows.filter((row) => row.slots.some((slot) => slot.length > 0)).length;
  const usedChars = new Set(rows.flatMap((row) => row.slots.flat()));

  // 情节完整度：场景齐全 15 + 四角色出场 5 + 每幕有人物 5
  let completeness = 0;
  completeness += uniqueCount === 6 ? 15 : uniqueCount === 5 ? 11 : uniqueCount === 4 ? 8 : 4;
  const charsPresent = CHARACTER_IDS.filter((id) => usedChars.has(id)).length;
  completeness += Math.round((charsPresent * 5) / 4);
  completeness += Math.round((charRows / usedRows.length) * 5);

  // 逻辑连贯度：25 分起扣
  let coherence = 25;
  const s1 = sceneIds.indexOf("S1");
  const s5 = sceneIds.indexOf("S5");
  if (s1 !== -1 && s5 !== -1 && s5 < s1) coherence -= 5;
  const lastFilledIndex = rows.reduce((acc, row, index) => (row.sceneId ? index : acc), -1);
  if (sceneIds.includes("S6") && sceneIds.lastIndexOf("S6") !== lastFilledIndex) coherence -= 5;
  if (uniqueCount < sceneIds.length) coherence -= 4;
  if (uniqueCount < 6) coherence -= 4;
  if (charRows < usedRows.length) coherence -= 3;
  coherence = Math.max(0, coherence);

  // 主题契合度：基础 15，围绕爱情与冲突主题加减
  let theme = 15;
  if (rows.some((row) => row.slots.flat().includes("C1") && row.slots.flat().includes("C2"))) {
    theme += 5;
  }
  if (rows.some((row) => row.sceneId === "S4" && row.slots[0].length && row.slots[1].length)) {
    theme += 3;
  }
  if (rows.some((row) => row.sceneId === "S6" && row.slots[0].length && row.slots[1].length)) {
    theme += 2;
  }
  if (usedChars.size > 0 && !usedChars.has("C3") && !usedChars.has("C4")) theme -= 6;
  theme = Math.max(0, theme);

  // 文化还原度：基础 10，经典顺序 + 经典角色配置 + 创造分
  let culture = 10;
  const isClassicOrder = sceneIds.length === 6 && sceneIds.every((id, index) => id === CLASSIC_ORDER[index]);
  if (isClassicOrder) culture += 8;
  culture += countClassicConfig(rows);
  if (!isClassicOrder && coherence === 25) culture += 3;
  culture = Math.min(25, culture);

  const base = completeness + coherence + theme + culture;
  const bonus = matchedStory ? 15 : 0;
  let total = base + bonus;
  if (matchedStory) total = Math.max(total, 85);
  total = Math.min(total, 100);

  return { completeness, coherence, theme, culture, bonus, total, grade: gradeOf(total) };
}

// ---------------------------------------------------------------------------
// 结局推导
// ---------------------------------------------------------------------------

/**
 * 判定结局类型。匹配已验证路径时使用数据中的权威分类；
 * 其余按 S6 塔内被囚者（B 槽）近似推导，无 S6 或被囚者返回 null（故事未竟）。
 */
function deriveEndingType(state, matchedStory) {
  if (matchedStory) return matchedStory.ending;

  const row = state.scenes.find((r) => r.sceneId === "S6");
  if (!row) return null;

  const outside = row.slots[0];
  const imprisoned = row.slots[1];
  if (imprisoned.length === 0) return null;
  if (imprisoned.length > 1) return "关系重构";

  const prisoner = imprisoned[0];
  if (prisoner === "C4" && outside.includes("C1") && !outside.includes("C2")) {
    return "关系重构"; // 白素贞塔外凝望小青，对应编号 9/13 式关系重构
  }
  if (prisoner === "C1") return "经典悲剧";
  if (prisoner === "C2") return "全面反转";
  if (prisoner === "C3") return "反派颠覆";
  if (prisoner === "C4") return "角色替换";
  return null;
}

window.BaisheNarrative = Object.freeze({
  SCENE_IDS,
  CHARACTER_IDS,
  CLASSIC_ORDER,
  ROW_COUNT,
  SCENE_ROLES,
  createEmptyState,
  storyToState,
  cloneState,
  createRandomState,
  sceneNameOf,
  sceneImageOf,
  charNameOf,
  charImageOf,
  joinNames,
  renderSceneText,
  renderStoryTexts,
  matchStoryPath,
  computeHints,
  gradeOf,
  computeScore,
  deriveEndingType,
});
})();
