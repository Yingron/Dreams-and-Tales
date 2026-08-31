import { defineGameModule } from "./game-template.js";

let mountedContainer = null;
let eventController = null;

/**
 * 白蛇传示例模块。
 * 后续开发可直接替换 init 内部的占位 HTML，同时保留生命周期接口。
 */
export default defineGameModule({
  id: "baishe",
  name: "白蛇传",

  init(container, config = {}) {
    this.destroy();
    mountedContainer = container;
    eventController = new AbortController();

    container.innerHTML = `
      <article class="game-stage" aria-labelledby="baishe-stage-title">
        <div class="game-stage__visual">
          <img
            class="game-stage__image"
            src="./src/assets/images/baishe/S5.png"
            alt="白蛇传断桥重逢场景卡"
          />
        </div>
        <div class="game-stage__panel">
          <p class="game-stage__eyebrow">故事卷 · 壹</p>
          <h3 id="baishe-stage-title" class="game-stage__title">白蛇传</h3>
          <p class="game-stage__description">
            白蛇传游戏开发中……统一挂载点、素材编号与生命周期接口均已准备完毕。
          </p>
          <div class="game-stage__rule" aria-hidden="true"></div>
          <dl class="game-stage__meta">
            <div class="game-stage__meta-row">
              <dt>素材就绪</dt>
              <dd>S1–S6 场景卡 · C1–C4 角色卡</dd>
            </div>
            <div class="game-stage__meta-row">
              <dt>模块接口</dt>
              <dd>init / destroy 已接入，可继续开发卡片与故事逻辑</dd>
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
