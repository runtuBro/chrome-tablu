# Tablu 开发说明

面向要改代码、或想搞清楚它为什么这样实现的人。用户文档见 [README.md](README.md)。

## 环境

Node 18+ / npm 9+，Chrome 110+（`minimum_chrome_version` 在 manifest 里写死）。

```bash
npm install
```

## 命令

```bash
npm run build       # 三段构建，产物进 dist/
npm run typecheck   # tsc --noEmit
npm run watch       # content 改动时增量重建

npm run build:content   # 只重建注入到页面的面板
npm run build:bg        # 只重建 service worker
npm run build:panel     # 只重建独立面板页
```

改完代码后：`npm run build` → `chrome://extensions` 点该扩展的刷新按钮 → 刷新网页。

## 目录

```
public/manifest.json   MV3 清单
public/panel.html      独立面板页的 HTML 壳（只有一个 <div id="root"> 和一个 script）
public/icons/          16/32/48/128 图标，由 scripts/make-icons.mjs 生成
src/background/        Service Worker：读标签页、推快照、执行操作
src/content/           注入到页面的面板（React + Shadow DOM）
  ├── index.tsx        挂载入口：建 host、attachShadow、注册消息监听
  ├── App.tsx          外壳：遮罩、主题、Esc、两种形态
  ├── store.ts         Zustand：列表数据、设置、收藏、折叠状态
  ├── panelChannel.ts  与 background 的长连接
  └── components/      TabList（列表）/ SettingsView（设置页）
src/panel/             独立面板页入口，复用 content/App
src/shared/            类型、消息协议、i18n 字典
scripts/make-icons.mjs 纯 Node 生成图标（zlib + 手写 CRC32）
docs/images/           README 展示图
```

## 三段式构建

MV3 的 content script **不支持 ES module**，manifest 里只能挂普通脚本；而 Rollup 在多入口时不允许 `iife` 格式（代码分割与 IIFE 互斥）。所以用 `ENTRY` 环境变量把入口拆成三次独立构建：

```jsonc
"build:content": "ENTRY=content vite build -c vite.ext.config.ts",
"build:bg":      "ENTRY=background vite build -c vite.ext.config.ts",
"build:panel":   "ENTRY=panel vite build -c vite.ext.config.ts",
"build":         "npm run build:content && npm run build:bg && npm run build:panel"
```

```ts
build: {
  outDir: rootDir + 'dist',
  emptyOutDir: key === 'content',   // 只有第一段清空（顺便拷 public），其余追加
  rollupOptions: {
    input: rootDir + entry.input,
    output: { format: 'iife', inlineDynamicImports: true, entryFileNames: entry.file },
  },
}
```

CSS 不单独出文件：用 `import styles from './styles.css?inline'` 拿到字符串，content script 塞进 shadow root 的 `<style>`，独立页塞进 `document.head`。同一份样式，两种挂载点。

产物（v0.9）：

```
dist/content.js     315 kB (gzip 76 kB)   ← 含 React 与 Tailwind
dist/panel.js       315 kB (gzip 76 kB)   ← 同上，独立页用
dist/background.js  8.3 kB (gzip 2.8 kB)
```

## 几个关键实现

### 按需注入，不是常驻

manifest 里**不声明** `content_scripts`。点击图标时才用 `scripting.executeScript` 往当前页注入 `content.js`。

开 20 个标签页 = 0 份 React 运行时；只有点过的那个页面才有。代价是第一次点击要解析 315 KB 脚本（约 20-30ms），之后同一页面再点就是瞬开。

这也是能去掉 `host_permissions`、改用 `activeTab` 的前提。

### 数据是推的，走长连接 Port

background 监听 8 类标签页事件（`onCreated` / `onRemoved` / `onUpdated` / `onActivated` / `onMoved` / `onAttached` / `onDetached` / `onReplaced`）以及 `windows.*`、`tabGroups.*`，全部汇到同一个 180ms 防抖函数，然后通过 Port 推给打开着面板的标签页。

**为什么不用 `tabs.sendMessage`：** MV3 的 service worker 空闲 30 秒会被回收，模块级变量（比如"哪些标签页开着面板"这个登记）随之消失。回收后广播发不出去，面板看着正常、内容却停在几分钟前，而且不报错。

Port 会在 SW 回收时自动断开，content 立刻感知并重连（退避 200ms → 2s 封顶），background 在 `onConnect` 里主动推一份最新快照。用户看到的只是列表自己刷新了一下。

### Shadow DOM 双向隔离

host 元素用 `all: initial` + 0×0 + `pointer-events: none`，面板挂在 `attachShadow({ mode: 'open' })` 里。

宿主的 CSS 进不来，Tailwind 的 reset 也出不去。这是往任意网站注入 UI 唯一可靠的做法，比 `!important` 大战稳得多。

关闭面板时不禁用页面滚动（那会污染宿主页面，某些站点会出诡异 bug），改用遮罩层的 `overscroll-behavior: contain`。

### 颜色全部走 CSS 变量

`bg-surface` / `text-ink-500` / `border-hairline` / `bg-hoverbg` 这些语义类名映射到 CSS 变量，浅色深色各一组值，挂在 `.tm-overlay` 上。

组件代码里**没有一处 `dark:` 变体**——切主题只换一组变量值。

### 独立面板页复用同一个 App

`src/panel/index.tsx` 挂的是 `content/App`，只是传了 `standalone`：铺满视口、无遮罩、不响应点外部关闭、`role` 从 `dialog` 改成 `main`。

页面里 `visible` 变 false（点标签跳转 / 按 Esc）的含义是"用完了"，直接关掉这个标签页。

`buildSnapshot` 会过滤掉 `panel.html` 自己，否则面板会把自己列出来。

## 调试与验证

这套扩展不好用肉眼验证（面板要注入、SW 会被回收、特权页不能注入），实践中用 Playwright + 自带的 Chromium：

- **系统 Chrome 137+ 移除了 `--load-extension`**，无法用命令行加载未打包扩展，只能用 Playwright 的 Chromium
- **必须 `headless: false`**，headless 模式下扩展不加载
- **扩展路径不能含中文**，先 `cp -R dist /tmp/tmext`
- 无法点击浏览器工具栏图标，改为在 service worker 上下文里 `chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_PANEL' })` 触发
- 测试副本可临时加 `host_permissions` 绕过 `activeTab` 的自动化限制（**不要提交这个改动**）

模拟 MV3 回收 service worker：

```js
const cdp = await ctx.newCDPSession(page);
await cdp.send('ServiceWorker.enable');
await cdp.send('ServiceWorker.stopAllWorkers');
```

## 提交约定

提交信息写清楚**做了什么**和**为什么**，不要只写"update"。视觉调整要说明改了哪个值、为什么改。
