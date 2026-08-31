# 奇谭织梦

“奇谭织梦”是一个以中国民间文学为主题的纯前端互动叙事项目。当前版本完成了项目骨架、品牌开始界面、白蛇传与孔雀东南飞双入口、统一游戏模块接口，以及全部卡片图片的规范化归档。

## 当前功能

- 古朴水墨／剪纸意象的响应式开始界面；
- `#/baishe` 与 `#/kongque` 两个 SPA 路由；
- 游戏模块动态载入，切换前自动执行 `destroy()`；
- 两个可直接替换的占位游戏模块；
- 59 份图片资源按策划编号归档（含 3 份白蛇传备选图）；
- 卡片基础数据 JSON 与策划文档副本。

## 目录结构

```text
Dreams-and-Tales/
├─ index.html                         # 单页应用入口与无障碍页面骨架
├─ README.md                          # 项目说明
├─ .gitignore                         # 本地缓存、构建输出等忽略规则
├─ docs/
│  ├─ README.md                       # 策划文档索引
│  ├─ card-id-reference.md            # 卡片编号与原文件名对照
│  └─ planning/                       # 原始策划文档副本
└─ src/
   ├─ css/
   │  └─ style.css                    # 全局主题、BEM 组件与响应式样式
   ├─ js/
   │  ├─ main.js                      # 首页交互、动态导入与模块生命周期
   │  ├─ router.js                    # GitHub Pages 兼容的 hash 路由
   │  ├─ game-template.js             # 游戏模块接口、校验和定义辅助函数
   │  ├─ baishe.js                    # 白蛇传示例／占位模块
   │  └─ kongque.js                   # 孔雀东南飞占位模块
   └─ assets/
      ├─ data/
      │  ├─ baishe-cards.json         # 白蛇传基础卡片清单
      │  └─ kongque-cards.json        # 孔雀东南飞基础卡片清单
      └─ images/
         ├─ README.md                 # 图片维护与新增规则
         ├─ baishe/                   # S1–S6、C1–C4 与 variants/
         └─ kongque/                  # S01–S12、C01–C12、E01–E22
```

## 本地运行

本项目使用原生 ES Modules 和动态 `import()`。为避免浏览器对 `file://` 模块的安全限制，推荐通过静态服务器打开，而不是双击 `index.html`。

### 方式一：Live Server

1. 用 VS Code 打开仓库目录；
2. 安装并启用 Live Server；
3. 右键 `index.html`，选择 **Open with Live Server**。

### 方式二：Python 静态服务器

在仓库根目录运行：

```bash
python -m http.server 5500
```

然后访问 `http://localhost:5500/`。

## 游戏模块接口

每个游戏文件默认导出一个对象，并至少实现以下字段：

```javascript
export default {
  id: "baishe", // 或 "kongque"
  name: "白蛇传",
  init(container, config) {
    // 在 container 中渲染，并绑定事件、读取数据。
  },
  destroy() {
    // 移除事件监听、停止计时器并清空容器。
  },
};
```

建议从 `game-template.js` 导入 `defineGameModule()`。主程序向 `config` 提供：

- `navigate(route)`：跳转到 `home`、`baishe` 或 `kongque`；
- `route`：当前游戏路由；
- `theme`：当前主题标识，现为 `ink-paper`。

模块切换流程固定为：

```text
点击入口 → 更新 hash → destroy 旧模块 → 动态导入新模块 → 校验接口 → init 挂载
```

## 后续开发建议

1. 在对应模块的 `init()` 中搭建游戏内部界面；
2. 从 `src/assets/data/` 读取卡片清单，避免把卡片信息散写在组件中；
3. 所有监听器统一交给 `AbortController` 管理，或在 `destroy()` 中逐一移除；
4. 定时器、音频与动画句柄必须在 `destroy()` 中停止；
5. 游戏内部状态不要写入 `main.js`，两个故事模块应保持彼此独立；
6. 新规则优先扩展 JSON 字段，并同步更新 `src/assets/data/README.md`。

## 图片资源维护

本次输入图片均为 PNG，已经完成复制和标准编号。后续新增素材时：

1. 先在策划文档中确定唯一 ID；
2. 将图片统一导出为 PNG 或 WebP；
3. 文件名只使用卡片 ID，例如 `S07.png`、`C03.png`、`E12.png`；
4. 把文件放入对应游戏目录；
5. 更新相应 JSON 数据与 `docs/card-id-reference.md`；
6. 不要在代码中通过中文原文件名引用资源。

完整原文件名映射与白蛇传备选图策略见 `docs/card-id-reference.md`。

## GitHub Pages

项目入口位于仓库根目录，所有路径均为相对路径，hash 路由也不依赖服务端重写。将 `main` 分支根目录设置为 GitHub Pages 发布源即可作为静态站点部署。

## 浏览器支持

建议使用近两年版本的 Chrome、Edge、Firefox 或 Safari。页面以桌面端为主，并适配常见平板和窄屏浏览器；同时支持键盘操作与“减少动态效果”系统设置。
