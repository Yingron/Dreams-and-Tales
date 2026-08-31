import { defineGameModule } from "./game-template.js";

let mountedContainer = null;
let eventController = null;

/** 孔雀东南飞占位模块，接口与白蛇传保持一致。 */
export default defineGameModule({
  id: "kongque",
  name: "孔雀东南飞",

  init(container, config = {}) {
    this.destroy();
    mountedContainer = container;
    eventController = new AbortController();

    container.innerHTML = `
      <article class="game-stage" aria-labelledby="kongque-stage-title">
        <div class="game-stage__visual">
          <img
            class="game-stage__image"
            src="./src/assets/images/kongque/S04.png"
            alt="孔雀东南飞焦家门前场景卡"
          />
        </div>
        <div class="game-stage__panel">
          <p class="game-stage__eyebrow">故事卷 · 贰</p>
          <h3 id="kongque-stage-title" class="game-stage__title">孔雀东南飞</h3>
          <p class="game-stage__description">
            孔雀东南飞游戏开发中……五幕叙事所需的三类卡片素材已按策划编号整理。
          </p>
          <div class="game-stage__rule" aria-hidden="true"></div>
          <dl class="game-stage__meta">
            <div class="game-stage__meta-row">
              <dt>素材就绪</dt>
              <dd>S01–S12 · C01–C12 · E01–E22</dd>
            </div>
            <div class="game-stage__meta-row">
              <dt>模块接口</dt>
              <dd>init / destroy 已接入，可继续开发五幕编排与评分逻辑</dd>
            </div>
          </dl>
          <button class="game-stage__button" type="button" data-module-back>
            <span aria-hidden="true">←</span>
            返回故事卷
          </button>
        </div>
      </article>
    `;

    container.querySelector("[data-module-back]")?.addEventListener(
      "click",
      () => config.navigate?.("home"),
      { signal: eventController.signal },
    );
  },

  destroy() {
    eventController?.abort();
    eventController = null;

    if (mountedContainer) {
      mountedContainer.replaceChildren();
      mountedContainer = null;
    }
  },
});
