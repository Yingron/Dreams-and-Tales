# 奇谭织梦

“奇谭织梦”是一个以中国民间文学为主题的纯前端互动叙事游戏。目前包含《白蛇传》和《孔雀东南飞》两套可交互玩法，项目不需要后端服务、包管理器或构建步骤，可直接部署到 GitHub Pages。

## 当前实现

### 白蛇传

- 六幕场景与人物卡片编排；
- 17 条经过预先验证的故事路径；
- 自由编排与随机编排；
- 根据人物槽位即时生成六幕叙事；
- 时序、场景和人物关系柔性提示；
- 经典悲剧、角色替换、反派颠覆、关系重构、全面反转五类结局；
- 情节完整度、逻辑连贯度、主题契合度、文化还原度四维评分。

### 孔雀东南飞

- 五个逐步解锁的故事关卡；
- 场景、人物和事件卡片编排；
- 教学提示、逻辑校验、结局与星级评分；
- 图鉴、随机命题和织梦卷轴存档；
- 经典线与多条改写路线。

首页使用 hash 路由切换故事：

- `#/`：故事首页；
- `#/baishe`：白蛇传；
- `#/kongque`：孔雀东南飞。

## 启动方式

项目入口是仓库根目录的 `index.html`，无需执行 `npm install`。

### 方式一：使用本地静态服务器（推荐）

在 Windows PowerShell 中执行：

```powershell
Set-Location "C:\Users\荣光\Desktop\暑期实践——奇谭织梦\Dreams-and-Tales"
python -m http.server 5500 --bind 127.0.0.1
```

浏览器打开：

```text
http://127.0.0.1:5500/
```

关闭服务时，在运行命令的终端中按 `Ctrl+C`。

推荐使用这种方式进行开发和验收，因为浏览器控制台、资源请求和错误信息更容易检查。

### 方式二：直接双击 index.html

直接双击仓库根目录的 `index.html` 也可以运行。项目已使用按顺序加载的普通脚本，并为 JSON 数据提供浏览器脚本镜像，因此不会依赖 `file://` 环境中经常被拦截的模块导入或本地 `fetch()`。

如果浏览器仍显示修改前的页面，请关闭旧标签页后重新打开 `index.html`，或执行强制刷新。

### 方式三：VS Code Live Server

1. 使用 VS Code 打开 `Dreams-and-Tales` 文件夹；
2. 安装并启用 Live Server；
3. 右键根目录的 `index.html`；
4. 选择 **Open with Live Server**。

## 发布到 GitHub Pages

本项目是纯静态网站，入口和资源路径均兼容 GitHub Pages。建议使用 `main` 分支根目录发布：

1. 将功能分支的 Pull Request 合并到 `main`；
2. 打开 GitHub 仓库的 **Settings → Pages**；
3. 在 **Build and deployment** 中将 **Source** 设为 **Deploy from a branch**；
4. Branch 选择 `main`，目录选择 `/(root)`；
5. 点击 **Save**，等待 GitHub Pages 完成首次部署。

发布地址预计为：

```text
https://yingron.github.io/Dreams-and-Tales/
```

故事页面继续通过 hash 访问，例如：

```text
https://yingron.github.io/Dreams-and-Tales/#/baishe
https://yingron.github.io/Dreams-and-Tales/#/kongque
```

hash 路由不会要求 GitHub Pages 配置服务器端重写。后续提交合并到 `main` 后，Pages 会自动重新发布。
仓库根目录的 `.nojekyll` 会让 Pages 原样发布静态文件，不执行 Jekyll 转换。

## 数据维护

游戏规则与文本以 `src/assets/data/*.json` 为源文件。为了兼容直接双击 `index.html`，仓库同时保留由 JSON 自动生成的 JavaScript 数据镜像。

修改白蛇传数据后执行：

```powershell
.\tools\sync-baishe-data.ps1
```

修改孔雀东南飞数据后执行：

```powershell
.\tools\sync-kongque-data.ps1
```

生成的 `baishe-cards.js`、`baishe-stories.js` 和 `kongque-cards.js` 应与对应 JSON 一起提交，不要直接编辑生成文件。

## 目录结构

```text
Dreams-and-Tales/
├─ index.html                         # 网站入口和故事选择页
├─ README.md                          # 启动、维护与发布说明
├─ .nojekyll                          # GitHub Pages 直接发布静态文件
├─ docs/                              # 策划文档与素材编号说明
├─ tools/
│  ├─ sync-baishe-data.ps1            # 生成白蛇传浏览器数据镜像
│  └─ sync-kongque-data.ps1           # 生成孔雀东南飞浏览器数据镜像
└─ src/
   ├─ css/
   │  └─ style.css                    # 首页及两套游戏的响应式样式
   ├─ js/
   │  ├─ main.js                      # 首页交互与游戏生命周期
   │  ├─ router.js                    # hash 路由
   │  ├─ game-template.js             # 游戏模块接口和校验
   │  ├─ baishe-narrative.js          # 白蛇叙事、提示、匹配和评分引擎
   │  ├─ baishe.js                    # 白蛇传六幕卡片游戏界面
   │  └─ kongque.js                   # 孔雀东南飞五关游戏界面
   └─ assets/
      ├─ data/                         # JSON 源数据及浏览器数据镜像
      └─ images/
         ├─ baishe/                    # 白蛇传场景卡和人物卡
         └─ kongque/                   # 孔雀东南飞场景、人物和事件卡
```

## 模块约定

游戏模块注册到 `window.DreamsGames`，并实现统一生命周期：

```javascript
const gameModule = window.DreamsGameCore.defineGameModule({
  id: "baishe",
  name: "白蛇传",
  init(container, config) {
    // 渲染界面并绑定事件。
  },
  destroy() {
    // 清理事件、计时器和界面状态。
  },
});

window.DreamsGames.baishe = gameModule;
```

主程序提供的 `config` 包含：

- `navigate(route)`：跳转到 `home`、`baishe` 或 `kongque`；
- `route`：当前游戏路由；
- `theme`：当前主题标识。

## 浏览器支持

建议使用近期版本的 Chrome、Edge、Firefox 或 Safari。页面支持键盘操作、常见桌面与移动端宽度，以及“减少动态效果”系统设置。
