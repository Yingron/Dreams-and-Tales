import { assertGameModule } from "./game-template.js";
import { createRouter, ROUTES } from "./router.js";

const homeView = document.querySelector("#home-view");
const gameView = document.querySelector("#game-view");
const gameContainer = document.querySelector("#game-container");
const gameTitle = document.querySelector("#game-view-title");

const moduleLoaders = Object.freeze({
  [ROUTES.BAISHE]: () => import("./baishe.js"),
  [ROUTES.KONGQUE]: () => import("./kongque.js"),
});

const router = createRouter();
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let activeModule = null;
let navigationVersion = 0;

const wait = (milliseconds) =>
  new Promise((resolve) => window.setTimeout(resolve, reducedMotion.matches ? 0 : milliseconds));

/**
 * 在首页与游戏区之间执行淡入淡出。
 * @param {HTMLElement} targetView 即将显示的视图。
 */
async function activateView(targetView) {
  const currentView = document.querySelector(".view--active");

  if (currentView === targetView) {
    targetView.hidden = false;
    return;
  }

  if (currentView) {
    currentView.classList.add("view--leaving");
    await wait(170);
    currentView.hidden = true;
    currentView.classList.remove("view--active", "view--leaving");
  }

  targetView.hidden = false;
  // 强制浏览器提交 hidden 状态，确保重复导航时动画仍会触发。
  void targetView.offsetWidth;
  targetView.classList.add("view--active");
  window.scrollTo({ top: 0, behavior: reducedMotion.matches ? "auto" : "smooth" });
}

/** 清理当前游戏，避免事件监听和计时器泄漏。 */
function destroyActiveModule() {
  if (activeModule) {
    activeModule.destroy();
    activeModule = null;
  }

  gameContainer.replaceChildren();
}

/**
 * 根据路由动态载入游戏模块。
 * @param {'home'|'baishe'|'kongque'} route 当前路由。
 */
async function renderRoute(route) {
  const version = ++navigationVersion;

  if (route === ROUTES.HOME) {
    destroyActiveModule();
    document.title = "奇谭织梦｜民间文学互动叙事";
    await activateView(homeView);
    return;
  }

  const loadModule = moduleLoaders[route];
  if (!loadModule) {
    router.navigate(ROUTES.HOME);
    return;
  }

  gameContainer.setAttribute("aria-busy", "true");
  destroyActiveModule();

  try {
    const importedModule = await loadModule();
    if (version !== navigationVersion) {
      return;
    }

    const nextModule = importedModule.default;
    assertGameModule(nextModule);
    activeModule = nextModule;

    gameTitle.textContent = nextModule.name;
    document.title = `${nextModule.name}｜奇谭织梦`;
    await activateView(gameView);

    if (version !== navigationVersion) {
      return;
    }

    nextModule.init(gameContainer, {
      navigate: router.navigate,
      route,
      theme: "ink-paper",
    });
  } catch (error) {
    console.error("游戏模块载入失败：", error);
    await activateView(gameView);
    gameTitle.textContent = "载入失败";
    gameContainer.innerHTML = `
      <section class="game-error" role="alert">
        <h3 class="game-error__title">故事卷暂时无法展开</h3>
        <p class="game-error__message">请返回首页后重试，或检查模块是否遵循统一接口。</p>
      </section>
    `;
  } finally {
    if (version === navigationVersion) {
      gameContainer.setAttribute("aria-busy", "false");
    }
  }
}

// 统一事件代理：新增首页入口时无需重复绑定监听器。
document.addEventListener("click", (event) => {
  const gameButton = event.target.closest("[data-game]");
  const routeButton = event.target.closest("[data-route]");

  if (gameButton) {
    router.navigate(gameButton.dataset.game);
    return;
  }

  if (routeButton) {
    event.preventDefault();
    router.navigate(routeButton.dataset.route);
  }
});

router.subscribe((route) => {
  void renderRoute(route);
});
router.start();
