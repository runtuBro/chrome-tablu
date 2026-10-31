/**
 * 独立面板页（chrome-extension://<id>/panel.html）
 *
 * 用途：在 chrome:// 这类禁止注入的页面上点击图标时，改为开一个新标签页
 * 展示同一份列表。扩展页面本身就是扩展的一部分，不受注入限制，也不需要
 * 任何额外权限——这是唯一可靠的做法（往新开的普通网页注入需要
 * host_permissions，而 activeTab 的授权只覆盖点击时所在的那个标签页）。
 *
 * 与 content script 的差别只有三点：
 *  1. 样式直接注入 document.head，而不是挂到 shadow root
 *  2. 面板以 standalone 模式渲染（铺满视口、没有遮罩）
 *  3. 关闭面板 = 关闭这个标签页
 */
import { createRoot } from 'react-dom/client';
import styles from '../content/styles.css?inline';
import { App } from '../content/App';
import { useStore } from '../content/store';

function injectStyles(): void {
  const el = document.createElement('style');
  el.textContent = styles;
  document.head.appendChild(el);
}

async function closeSelf(): Promise<void> {
  try {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id != null) await chrome.tabs.remove(tab.id);
    else window.close();
  } catch {
    window.close();
  }
}

function boot(): void {
  injectStyles();

  const container = document.getElementById('root');
  if (!container) return;

  createRoot(container).render(<App standalone />);

  // 先读设置再打开，避免首帧用默认主题闪一下
  void useStore.getState().loadSettings();
  useStore.getState().setVisible(true);

  // 跳转到某个标签 / 按 Esc 都会把 visible 置为 false，
  // 在独立页里这个动作的含义是"用完了"，直接把当前标签页关掉。
  useStore.subscribe((state, prev) => {
    if (prev.visible && !state.visible) void closeSelf();
  });
}

boot();
