import { createRoot } from 'react-dom/client';
import styles from './styles.css?inline';
import { App } from './App';
import { useStore } from './store';
import type { BackgroundMessage } from '../shared/protocol';

const HOST_ID = '__tabmind_host__';

/**
 * 把面板挂到页面里。
 *
 * 三个关键点：
 * 1. host 用 0×0 + pointer-events:none，面板关闭时对宿主页面零影响
 * 2. Shadow DOM 做双向样式隔离（宿主进不来，我们出不去）
 * 3. 幂等：SPA 路由或重复注入时不会挂出第二个面板
 */
function mount(): void {
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = [
    'all: initial',
    'position: fixed',
    'top: 0',
    'left: 0',
    'width: 0',
    'height: 0',
    'z-index: 2147483646',
    'pointer-events: none',
  ].join('; ');

  const shadow = host.attachShadow({ mode: 'open' });

  const styleEl = document.createElement('style');
  styleEl.textContent = styles;
  shadow.appendChild(styleEl);

  const container = document.createElement('div');
  container.id = 'root';
  shadow.appendChild(container);

  document.documentElement.appendChild(host);

  createRoot(container).render(<App />);
}

/**
 * 防重复初始化。
 *
 * background 在页面没有 content script 时（扩展装好之前就打开的页面）
 * 会用 chrome.scripting.executeScript 再注入一次本文件。如果这个标记不设，
 * 第二次执行会注册第二个 onMessage 监听器，一次 TOGGLE 被处理两次，
 * 表现为「面板闪一下就关」。
 */
const BOOT_FLAG = '__tabmind_booted__';

function boot(): void {
  if ((window as unknown as Record<string, unknown>)[BOOT_FLAG]) return;
  (window as unknown as Record<string, unknown>)[BOOT_FLAG] = true;

  chrome.runtime.onMessage.addListener((msg: BackgroundMessage, _sender, sendResponse) => {
    const store = useStore.getState();

    switch (msg.type) {
      case 'TOGGLE_PANEL':
        store.toggle();
        sendResponse({ ok: true });
        break;
      case 'OPEN_PANEL':
        store.setVisible(true);
        sendResponse({ ok: true });
        break;
      case 'TABS_SNAPSHOT':
        store.setGroups(msg.groups);
        sendResponse({ ok: true });
        break;
    }
    return false;
  });

  // 建 UI。数据不在这里预取——注入完成后 background 会立刻发 TOGGLE_PANEL，
  // setVisible(true) 自己会拉一次快照，省掉一次重复查询。
  mount();

  // 主题等设置要尽早读出来，否则首帧会先按默认值渲染再跳变
  void useStore.getState().loadSettings();
}

boot();
