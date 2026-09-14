(function () {
"use strict";

const { defineGameModule } = window.DreamsGameCore;
const narrative = window.BaisheNarrative;
const cards = window.BAISHE_CARDS;
const storyData = window.BAISHE_STORIES;
const CARD_DATA_URL = new URL("./src/assets/data/baishe-cards.json", document.baseURI);
const ACT_NAMES = ["初逢", "惊变", "寻药", "斗法", "重逢", "终局"];
const NUMBER_NAMES = ["一", "二", "三", "四", "五", "六"];

let mountedContainer = null;
let eventController = null;
let appElement = null;
let navigate = null;
let state = null;
let selectedCard = null;
let activeTab = "scenes";
let result = null;
let notice = "经典故事已展开，也可以选卡重织新的六幕传说。";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function imageUrl(path) {
  return new URL(path, CARD_DATA_URL).href;
}

function sceneOf(id) {
  return cards.scenes.find((card) => card.id === id) ?? null;
}

function characterOf(id) {
  return cards.characters.find((card) => card.id === id) ?? null;
}

function currentMatch() {
  return narrative.matchStoryPath(state, storyData.stories);
}

function markChanged(message) {
  result = null;
  notice = message;
}

function renderCard(card, kind) {
  const selected = selectedCard?.kind === kind && selectedCard.id === card.id;
  const kindLabel = kind === "scene" ? "场景卡" : "角色卡";
  return `
    <button
      class="baishe-card${selected ? " is-selected" : ""}"
      type="button"
      data-action="select-card"
      data-kind="${kind}"
      data-card-id="${card.id}"
      aria-pressed="${selected}"
      aria-label="选择${kindLabel}${escapeHtml(card.name)}"
    >
      <img class="baishe-card__image" src="${imageUrl(card.image)}" alt="" />
      <span class="baishe-card__caption">
        <span class="baishe-card__id">${card.id}</span>
        <span class="baishe-card__name">${escapeHtml(card.name)}</span>
      </span>
    </button>
  `;
}

function renderLibrary() {
  const list = activeTab === "scenes" ? cards.scenes : cards.characters;
  const kind = activeTab === "scenes" ? "scene" : "character";
  const selected = selectedCard
    ? `${selectedCard.kind === "scene" ? "场景" : "人物"}：${escapeHtml(
        (selectedCard.kind === "scene" ? sceneOf(selectedCard.id) : characterOf(selectedCard.id))
          ?.name ?? selectedCard.id,
      )}`
    : "尚未选卡";

  return `
    <aside class="baishe-library" aria-label="白蛇传卡片库">
      <div class="baishe-tabs" role="tablist" aria-label="卡片分类">
        <button class="baishe-tab${activeTab === "scenes" ? " is-active" : ""}" type="button"
          role="tab" aria-selected="${activeTab === "scenes"}" data-action="tab" data-tab="scenes">场景卡</button>
        <button class="baishe-tab${activeTab === "characters" ? " is-active" : ""}" type="button"
          role="tab" aria-selected="${activeTab === "characters"}" data-action="tab" data-tab="characters">角色卡</button>
      </div>
      <div class="baishe-library__grid">${list.map((card) => renderCard(card, kind)).join("")}</div>
      <p class="baishe-library__selection" aria-live="polite">${selected}</p>
      <p class="baishe-library__help">先选一张卡，再点击中间对应槽位。未选卡时点击已填槽位可清除内容。</p>
    </aside>
  `;
}

function renderSceneSlot(row, rowIndex) {
  const card = sceneOf(row.sceneId);
  return `
    <button class="baishe-slot baishe-slot--scene${card ? " is-filled" : ""}" type="button"
      data-action="place-scene" data-row="${rowIndex}"
      aria-label="第${NUMBER_NAMES[rowIndex]}幕场景${card ? `，当前${escapeHtml(card.name)}` : "，尚未放置"}">
      ${card ? `
        <img class="baishe-slot__scene-image" src="${imageUrl(card.image)}" alt="" />
        <span class="baishe-slot__scene-caption"><strong>${card.id}</strong>${escapeHtml(card.name)}</span>
      ` : "<span class=\"baishe-slot__empty\">＋ 放置场景</span>"}
    </button>
  `;
}

function renderCharacterSlot(row, rowIndex, slotIndex) {
  const ids = row.slots[slotIndex];
  const roles = narrative.SCENE_ROLES[row.sceneId] ?? ["角色位一", "角色位二", "角色位三"];
  const role = roles[slotIndex] || "附加角色";
  const content = ids.length
    ? ids
        .map((id) => {
          const card = characterOf(id);
          return card
            ? `<span class="baishe-slot__person"><img src="${imageUrl(card.image)}" alt="" /><span>${escapeHtml(card.name)}</span></span>`
            : "";
        })
        .join("")
    : "<span class=\"baishe-slot__empty\">＋ 放置人物</span>";

  return `
    <div class="baishe-role">
      <span class="baishe-role__label">${escapeHtml(role)}</span>
      <button class="baishe-slot baishe-slot--character${ids.length ? " is-filled" : ""}" type="button"
        data-action="place-character" data-row="${rowIndex}" data-slot="${slotIndex}"
        aria-label="第${NUMBER_NAMES[rowIndex]}幕${escapeHtml(role)}${ids.length ? `，当前${ids.map((id) => characterOf(id)?.name ?? id).join("、")}` : "，尚未放置"}">
        ${content}
      </button>
    </div>
  `;
}

function renderTimeline() {
  return `
    <section class="baishe-timeline" aria-labelledby="baishe-timeline-title">
      <div class="baishe-section-heading">
        <div>
          <p class="baishe-section-heading__eyebrow">六幕织梦台</p>
          <h3 id="baishe-timeline-title">重排场景与人物</h3>
        </div>
        <span>每幕 1 个场景 · 3 个语义角色槽</span>
      </div>
      <div class="baishe-acts">
        ${state.scenes
          .map(
            (row, rowIndex) => `
              <article class="baishe-act">
                <header class="baishe-act__header">
                  <div><span>第${NUMBER_NAMES[rowIndex]}幕</span><strong>${ACT_NAMES[rowIndex]}</strong></div>
                  <button type="button" data-action="clear-row" data-row="${rowIndex}" aria-label="清空第${NUMBER_NAMES[rowIndex]}幕">清空</button>
                </header>
                <div class="baishe-act__body">
                  ${renderSceneSlot(row, rowIndex)}
                  <div class="baishe-act__characters">
                    ${row.slots.map((_, slotIndex) => renderCharacterSlot(row, rowIndex, slotIndex)).join("")}
                  </div>
                </div>
              </article>
            `,
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderScoreBar(label, value) {
  return `
    <div class="baishe-score__row">
      <span>${label}</span>
      <span class="baishe-score__track" aria-hidden="true"><span style="width:${Math.min(100, value * 4)}%"></span></span>
      <strong>${value}/25</strong>
    </div>
  `;
}

function renderResult() {
  if (!result) {
    return `
      <div class="baishe-result baishe-result--pending">
        <p>完成编排后点击“织梦成篇”，查看结局类型与四维评分。</p>
      </div>
    `;
  }

  const { score, ending, matched } = result;
  return `
    <section class="baishe-result" aria-label="织梦结果">
      <p class="baishe-result__eyebrow">本卷结局</p>
      <h4>${escapeHtml(ending ?? "故事未竟")}</h4>
      <p class="baishe-result__grade">${score.total} 分 · ${escapeHtml(score.grade)}</p>
      ${matched ? `<p class="baishe-result__match">已命中验证路径 #${matched.id}「${escapeHtml(matched.tag)}」${score.bonus ? `，路径奖励 +${score.bonus}` : ""}</p>` : ""}
      <div class="baishe-score">
        ${renderScoreBar("情节完整", score.completeness)}
        ${renderScoreBar("逻辑连贯", score.coherence)}
        ${renderScoreBar("主题契合", score.theme)}
        ${renderScoreBar("文化还原", score.culture)}
      </div>
    </section>
  `;
}

function renderPreview() {
  const matched = currentMatch();
  const generated = narrative.renderStoryTexts(state, cards);
  const texts = state.scenes.map((row, index) => ({
    sceneId: row.sceneId,
    text: matched?.texts[index] ?? generated[index].text,
  }));
  const hints = narrative.computeHints(state, cards, matched);

  return `
    <aside class="baishe-preview" aria-labelledby="baishe-preview-title">
      <div class="baishe-section-heading baishe-section-heading--preview">
        <div>
          <p class="baishe-section-heading__eyebrow">即时叙事</p>
          <h3 id="baishe-preview-title">${matched ? escapeHtml(matched.tag) : "你的白蛇新传"}</h3>
        </div>
        ${matched ? `<span class="baishe-path-badge">验证路径 #${matched.id}</span>` : ""}
      </div>
      <ol class="baishe-story">
        ${texts
          .map((entry, index) => {
            const scene = sceneOf(entry.sceneId);
            return `
              <li class="baishe-story__item${entry.text ? " is-complete" : ""}">
                <span class="baishe-story__number">${NUMBER_NAMES[index]}</span>
                <div>
                  <strong>${scene ? escapeHtml(scene.name) : `第${NUMBER_NAMES[index]}幕待编`}</strong>
                  <p>${entry.text ? escapeHtml(entry.text) : "放入场景与人物，故事将在这里生长。"}</p>
                </div>
              </li>
            `;
          })
          .join("")}
      </ol>
      <div class="baishe-hints">
        <h4>织梦提示</h4>
        ${hints.length
          ? hints.map((hint) => `<p class="is-${hint.level}">${escapeHtml(hint.text)}</p>`).join("")
          : `<p class="is-good">${matched ? "这一编排与已验证故事完全吻合。" : "暂未发现明显的叙事冲突。"}</p>`}
      </div>
      ${renderResult()}
    </aside>
  `;
}

function renderPathOptions(matched) {
  return `
    <option value="">自由编排</option>
    ${storyData.stories
      .map(
        (story) => `<option value="${story.id}"${matched?.id === story.id ? " selected" : ""}>#${story.id} ${escapeHtml(story.tag)} · ${escapeHtml(story.ending)}</option>`,
      )
      .join("")}
  `;
}

function renderApp() {
  const matched = currentMatch();
  appElement.innerHTML = `
    <div class="baishe-toolbar">
      <label class="baishe-toolbar__picker">
        <span>故事路径</span>
        <select data-action="story-path" aria-label="选择已验证的白蛇传故事路径">
          ${renderPathOptions(matched)}
        </select>
      </label>
      <p class="baishe-toolbar__notice" aria-live="polite">${escapeHtml(notice)}</p>
      <div class="baishe-toolbar__actions">
        <button type="button" data-action="random">随手一编</button>
        <button type="button" data-action="clear-all">清空台面</button>
        <button class="is-primary" type="button" data-action="submit">织梦成篇</button>
      </div>
    </div>
    <div class="baishe-layout">
      ${renderLibrary()}
      ${renderTimeline()}
      ${renderPreview()}
    </div>
  `;
}

function placeScene(rowIndex) {
  const row = state.scenes[rowIndex];
  if (selectedCard?.kind === "scene") {
    state.scenes.forEach((candidate, index) => {
      if (index !== rowIndex && candidate.sceneId === selectedCard.id) candidate.sceneId = null;
    });
    row.sceneId = selectedCard.id;
    const name = sceneOf(selectedCard.id)?.name ?? selectedCard.id;
    selectedCard = null;
    markChanged(`已把“${name}”放入第${NUMBER_NAMES[rowIndex]}幕。`);
    return;
  }
  if (!selectedCard && row.sceneId) {
    row.sceneId = null;
    markChanged(`已移除第${NUMBER_NAMES[rowIndex]}幕场景。`);
    return;
  }
  notice = "请先从左侧场景卡中选择一张卡。";
}

function placeCharacter(rowIndex, slotIndex) {
  const row = state.scenes[rowIndex];
  const slot = row.slots[slotIndex];
  if (selectedCard?.kind === "character") {
    const charId = selectedCard.id;
    const alreadyHere = slot.includes(charId);
    if (!alreadyHere && slot.length >= 2) {
      notice = "一个语义角色槽最多容纳两名人物，请先清除其中一名。";
      return;
    }
    row.slots.forEach((candidate) => {
      const position = candidate.indexOf(charId);
      if (position !== -1) candidate.splice(position, 1);
    });
    if (!alreadyHere) {
      slot.push(charId);
    }
    const name = characterOf(charId)?.name ?? charId;
    selectedCard = null;
    markChanged(alreadyHere ? `已从该角色槽移除“${name}”。` : `已把“${name}”放入第${NUMBER_NAMES[rowIndex]}幕。`);
    return;
  }
  if (!selectedCard && slot.length) {
    slot.splice(0, slot.length);
    markChanged(`已清空第${NUMBER_NAMES[rowIndex]}幕的这个角色槽。`);
    return;
  }
  notice = "请先从左侧角色卡中选择一张卡。";
}

function handleClick(event) {
  const target = event.target.closest("[data-action]");
  if (!target) return;

  const action = target.dataset.action;
  if (action === "back") {
    navigate?.("home");
    return;
  }
  if (action === "tab") {
    activeTab = target.dataset.tab;
  } else if (action === "select-card") {
    const next = { kind: target.dataset.kind, id: target.dataset.cardId };
    selectedCard = selectedCard?.kind === next.kind && selectedCard.id === next.id ? null : next;
    notice = selectedCard ? "卡片已选中，请点击中间对应槽位放置。" : "已取消选卡。";
  } else if (action === "place-scene") {
    placeScene(Number(target.dataset.row));
  } else if (action === "place-character") {
    placeCharacter(Number(target.dataset.row), Number(target.dataset.slot));
  } else if (action === "clear-row") {
    state.scenes[Number(target.dataset.row)] = { sceneId: null, slots: [[], [], []] };
    selectedCard = null;
    markChanged(`第${NUMBER_NAMES[Number(target.dataset.row)]}幕已清空。`);
  } else if (action === "random") {
    state = narrative.createRandomState();
    selectedCard = null;
    markChanged("已生成一组随机编排，你可以继续调整后提交。");
  } else if (action === "clear-all") {
    state = narrative.createEmptyState();
    selectedCard = null;
    markChanged("织梦台已清空，请从场景卡开始重新编排。");
  } else if (action === "submit") {
    const matched = currentMatch();
    result = {
      matched,
      score: narrative.computeScore(state, matched),
      ending: narrative.deriveEndingType(state, matched),
    };
    notice = matched ? `织梦完成：命中“${matched.tag}”路径。` : "织梦完成：这是你独有的白蛇新传。";
  }

  renderApp();
}

function handleChange(event) {
  const target = event.target.closest('[data-action="story-path"]');
  if (!target) return;
  const story = storyData.stories.find((candidate) => String(candidate.id) === target.value);
  if (!story) {
    state = narrative.createEmptyState();
    selectedCard = null;
    result = null;
    notice = "已进入自由编排，请从场景卡开始织梦。";
    renderApp();
    return;
  }
  state = narrative.storyToState(story);
  selectedCard = null;
  result = null;
  notice = `已展开验证路径 #${story.id}“${story.tag}”。`;
  renderApp();
}

const baisheModule = defineGameModule({
  id: "baishe",
  name: "白蛇传",

  init(container, config = {}) {
    this.destroy();
    if (!narrative || !cards || !storyData?.stories?.length) {
      throw new Error("白蛇传叙事引擎或故事数据未正确载入。");
    }

    mountedContainer = container;
    navigate = config.navigate;
    eventController = new AbortController();
    state = narrative.storyToState(storyData.stories[0]);
    selectedCard = null;
    activeTab = "scenes";
    result = null;
    notice = "经典故事已展开，也可以选卡重织新的六幕传说。";

    const board = document.createElement("section");
    board.className = "baishe-board";
    board.setAttribute("aria-label", "白蛇传六幕织梦游戏");
    board.innerHTML = `
      <header class="baishe-board__header">
        <div>
          <p>西湖烟雨 · 六幕重织</p>
          <h2>白蛇传</h2>
          <span>从 17 条验证路径中寻回旧梦，或用场景与人物卡编织新的结局。</span>
        </div>
        <button type="button" data-action="back">← 返回故事卷</button>
      </header>
      <div class="baishe-app"></div>
    `;
    appElement = board.querySelector(".baishe-app");
    board.addEventListener("click", handleClick, { signal: eventController.signal });
    board.addEventListener("change", handleChange, { signal: eventController.signal });
    container.append(board);
    renderApp();
  },

  destroy() {
    eventController?.abort();
    eventController = null;
    appElement = null;
    navigate = null;
    state = null;
    selectedCard = null;
    result = null;

    if (mountedContainer) {
      mountedContainer.replaceChildren();
      mountedContainer = null;
    }
  },
});

window.DreamsGames = window.DreamsGames || {};
window.DreamsGames.baishe = baisheModule;
})();
