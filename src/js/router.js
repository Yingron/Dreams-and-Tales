/**
 * 单页路由控制器。
 * 路由写入 URL hash，因此可直接部署到 GitHub Pages，无需服务器重写规则。
 */

export const ROUTES = Object.freeze({
  HOME: "home",
  BAISHE: "baishe",
  KONGQUE: "kongque",
});

const VALID_ROUTES = new Set(Object.values(ROUTES));

/**
 * 把 URL hash 转成内部路由名称。
 * @param {string} hash 浏览器当前 hash，例如 #/baishe。
 * @returns {string} 合法路由；无效地址会回落到首页。
 */
function routeFromHash(hash) {
  const candidate = hash.replace(/^#\/?/, "").replace(/\/$/, "").toLowerCase();

  if (!candidate) {
    return ROUTES.HOME;
  }

  return VALID_ROUTES.has(candidate) ? candidate : ROUTES.HOME;
}

/**
 * 创建一个可订阅的轻量路由器。
 * @returns {{start: Function, stop: Function, navigate: Function, subscribe: Function, getRoute: Function}}
 */
export function createRouter() {
  const listeners = new Set();
  let currentRoute = routeFromHash(window.location.hash);
  let started = false;

  const notify = () => {
    currentRoute = routeFromHash(window.location.hash);
    listeners.forEach((listener) => listener(currentRoute));
  };

  const handleHashChange = () => {
    const requestedRoute = routeFromHash(window.location.hash);

    // 清理未知 hash，保证刷新和分享后的地址始终可预测。
    if (requestedRoute === ROUTES.HOME && !["", "#/", "#", "#/home"].includes(window.location.hash)) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#/`);
    }

    notify();
  };

  return {
    start() {
      if (started) {
        return;
      }

      started = true;
      window.addEventListener("hashchange", handleHashChange);
      handleHashChange();
    },

    stop() {
      window.removeEventListener("hashchange", handleHashChange);
      listeners.clear();
      started = false;
    },

    /**
     * 导航到指定页面。
     * @param {'home'|'baishe'|'kongque'} route 目标路由。
     */
    navigate(route) {
      const nextRoute = VALID_ROUTES.has(route) ? route : ROUTES.HOME;
      const nextHash = nextRoute === ROUTES.HOME ? "#/" : `#/${nextRoute}`;

      if (window.location.hash === nextHash) {
        notify();
        return;
      }

      window.location.hash = nextHash;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getRoute() {
      return currentRoute;
    },
  };
}
