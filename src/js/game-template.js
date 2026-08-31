/**
 * 游戏模块统一接口。
 *
 * 后续开发者可复制本文件中的 GameModule 对象，修改 id/name，并在 init 中渲染
 * 自己的游戏。main.js 会在切换前调用旧模块 destroy，再调用新模块 init。
 */

const GAME_IDS = new Set(["baishe", "kongque"]);

/** @type {HTMLElement|null} */
let templateContainer = null;

/**
 * 接口参考对象。它本身不被首页加载，仅用于展示完整契约。
 * @type {{id: 'baishe'|'kongque', name: string, init: Function, destroy: Function, pause?: Function, resume?: Function}}
 */
export const GameModule = {
  id: "baishe",
  name: "白蛇传",

  /**
   * 初始化游戏。
   * @param {HTMLElement} container 游戏唯一挂载点。
   * @param {object} [config] 主程序提供的可选配置。
   */
  init(container, config = {}) {
    if (!(container instanceof HTMLElement)) {
      throw new TypeError("GameModule.init 需要一个有效的 HTMLElement 容器。");
    }

    templateContainer = container;
    void config;
  },

  /** 清理事件、计时器和已渲染内容。 */
  destroy() {
    if (templateContainer) {
      templateContainer.replaceChildren();
      templateContainer = null;
    }
  },

  // 可选生命周期：pause() {} / resume() {}
};

/**
 * 检查模块是否符合统一接口，错误会尽早暴露给开发者。
 * @param {unknown} module 待检查的模块对象。
 * @returns {true}
 */
export function assertGameModule(module) {
  if (!module || typeof module !== "object") {
    throw new TypeError("游戏模块必须导出一个对象。");
  }

  if (!GAME_IDS.has(module.id)) {
    throw new TypeError("游戏模块 id 必须是 baishe 或 kongque。");
  }

  if (typeof module.name !== "string" || !module.name.trim()) {
    throw new TypeError("游戏模块必须提供非空 name。");
  }

  if (typeof module.init !== "function" || typeof module.destroy !== "function") {
    throw new TypeError("游戏模块必须实现 init(container, config) 与 destroy()。");
  }

  for (const optionalMethod of ["pause", "resume"]) {
    if (optionalMethod in module && typeof module[optionalMethod] !== "function") {
      throw new TypeError(`${optionalMethod} 存在时必须是函数。`);
    }
  }

  return true;
}

/**
 * 定义并冻结一个游戏模块，防止运行时意外修改生命周期方法。
 * @param {object} module 游戏模块实现。
 * @returns {Readonly<object>}
 */
export function defineGameModule(module) {
  assertGameModule(module);
  return Object.freeze(module);
}
