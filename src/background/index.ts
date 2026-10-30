/**
 * Background Service Worker
 *
 * 存在的理由：
 *  1. content script 看不到 chrome.tabs / chrome.windows，只能由这里代劳
 *  2. 标签页变化的聚合与广播
 *  3. 按需注入面板 —— 本扩展没有 content_scripts，页面加载时零开销，
 *     只有用户点了图标才往当前页面注入
 *
 * 本扩展没有任何网络请求，background 只做本地读写。
 */
import {
  NO_GROUP,
  type TabGroupColor,
  type TabGroupInfo,
  type TabItem,
  type WindowGroup,
} from '../shared/types';
import type { Request, Response } from '../shared/protocol';

/* ------------------------------------------------------------------ *
 * 标签页快照
 * ------------------------------------------------------------------ */

async function buildSnapshot(): Promise<WindowGroup[]> {
  const [windows, tabs, tabGroups] = await Promise.all([
    chrome.windows.getAll(),
    chrome.tabs.query({}),
    // 用户没用标签组时这里是空数组，后续逻辑不受影响
    chrome.tabGroups.query({}),
  ]);

  const groupInfo = new Map<number, TabGroupInfo>();
  for (const g of tabGroups) {
    groupInfo.set(g.id, {
      id: g.id,
      title: g.title ?? '',
      color: (g.color ?? 'grey') as TabGroupColor,
      collapsed: !!g.collapsed,
    });
  }

  const map = new Map<number, WindowGroup>();
  for (const w of windows) {
    if (w.id == null) continue;
    map.set(w.id, { windowId: w.id, focused: !!w.focused, tabs: [], groups: [] });
  }

  for (const t of tabs) {
    if (t.id == null || t.windowId == null) continue;
    let group = map.get(t.windowId);
    if (!group) {
      group = { windowId: t.windowId, focused: false, tabs: [], groups: [] };
      map.set(t.windowId, group);
    }
    const item: TabItem = {
      id: t.id,
      windowId: t.windowId,
      index: t.index,
      title: t.title ?? '',
      url: t.url ?? '',
      favIconUrl: t.favIconUrl,
      active: !!t.active,
      pinned: !!t.pinned,
      audible: !!t.audible,
      discarded: !!t.discarded,
      groupId: typeof t.groupId === 'number' ? t.groupId : NO_GROUP,
    };
    group.tabs.push(item);
  }

  const groups = [...map.values()].filter((g) => g.tabs.length > 0);

  for (const g of groups) {
    g.tabs.sort((a, b) => a.index - b.index);

    // 组在窗口内的顺序 = 组内第一个标签的位置，跟标签栏的视觉顺序一致
    const firstIndex = new Map<number, number>();
    for (const t of g.tabs) {
      if (t.groupId !== NO_GROUP && !firstIndex.has(t.groupId)) {
        firstIndex.set(t.groupId, t.index);
      }
    }
    g.groups = [...firstIndex.entries()]
      .sort((a, b) => a[1] - b[1])
      .map(([id]) => groupInfo.get(id))
      .filter((x): x is TabGroupInfo => Boolean(x));
  }

  // 当前聚焦的窗口排在最前，其余按创建顺序
  groups.sort(
    (a, b) => Number(b.focused) - Number(a.focused) || a.windowId - b.windowId,
  );
  return groups;
}

/* ------------------------------------------------------------------ *
 * 广播：只在面板真正打开着的标签页上发，避免全量骚扰
 * ------------------------------------------------------------------ */

const panelTabs = new Set<number>();
let broadcastTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleBroadcast(): void {
  if (broadcastTimer) clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(async () => {
    broadcastTimer = null;
    if (panelTabs.size === 0) return;
    const groups = await buildSnapshot();
    for (const tabId of [...panelTabs]) {
      chrome.tabs
        .sendMessage(tabId, { type: 'TABS_SNAPSHOT', groups })
        .catch(() => panelTabs.delete(tabId));
    }
  }, 180);
}

chrome.tabs.onCreated.addListener(scheduleBroadcast);
chrome.tabs.onActivated.addListener(scheduleBroadcast);
chrome.tabs.onMoved.addListener(scheduleBroadcast);
chrome.tabs.onAttached.addListener(scheduleBroadcast);
chrome.tabs.onDetached.addListener(scheduleBroadcast);
chrome.tabs.onReplaced.addListener(scheduleBroadcast);
chrome.tabs.onRemoved.addListener((tabId) => {
  panelTabs.delete(tabId);
  scheduleBroadcast();
});
chrome.tabs.onUpdated.addListener((_tabId, info) => {
  // 标题/图标变化非常频繁，只在这些有意义的状态上刷新
  if (info.status === 'complete' || info.title !== undefined || info.favIconUrl !== undefined) {
    scheduleBroadcast();
  }
});
chrome.windows.onFocusChanged.addListener(scheduleBroadcast);
chrome.windows.onRemoved.addListener(scheduleBroadcast);
// 用户改组名、改颜色、折叠/展开组，面板里的分组也要跟着变
chrome.tabGroups.onCreated.addListener(scheduleBroadcast);
chrome.tabGroups.onUpdated.addListener(scheduleBroadcast);
chrome.tabGroups.onRemoved.addListener(scheduleBroadcast);
chrome.tabGroups.onMoved.addListener(scheduleBroadcast);

/* ------------------------------------------------------------------ *
 * 唤起面板
 * ------------------------------------------------------------------ */

async function togglePanelOn(tabId: number): Promise<void> {
  // ① 面板已经在这个页面上（用户第二次点击）
  if (await trySendToggle(tabId)) return;

  // ② 常态：本扩展没有常驻 content script，页面里什么都没有。
  //    只有用户真的点了图标，才往「这一个」页面注入面板。
  //    这样开 50 个标签页也不会多出 50 份 React 运行时。
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    if (await trySendToggle(tabId)) return;
  } catch {
    // 特权页（chrome://、应用商店、PDF 查看器）会在这里被拒
  }

  await flashUnsupported(tabId);
}

async function trySendToggle(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_PANEL' });
    return true;
  } catch {
    return false;
  }
}

async function flashUnsupported(tabId: number): Promise<void> {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#ef4444' });
    await chrome.action.setBadgeText({ tabId, text: '!' });
    await chrome.action.setTitle({
      tabId,
      title: '此页面不支持：chrome:// 开头的页面禁止扩展注入，换个普通网页试试',
    });
    setTimeout(() => {
      chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
      chrome.action
        .setTitle({ tabId, title: '打开 TabMind 面板' })
        .catch(() => {});
    }, 3000);
  } catch {
    /* 标签页可能已经关了 */
  }
}

// manifest 里没有 default_popup，onClicked 才会触发
chrome.action.onClicked.addListener((tab) => {
  if (tab.id != null) void togglePanelOn(tab.id);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-panel') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id != null) void togglePanelOn(tab.id);
});

/* ------------------------------------------------------------------ *
 * 一次性请求处理
 * ------------------------------------------------------------------ */

chrome.runtime.onMessage.addListener((msg: Request, sender, sendResponse) => {
  handleRequest(msg, sender)
    .then(sendResponse)
    .catch((err: unknown) => {
      sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      } satisfies Response);
    });
  return true; // 保持通道打开以支持异步响应
});

async function handleRequest(
  msg: Request,
  sender: chrome.runtime.MessageSender,
): Promise<Response> {
  switch (msg.type) {
    case 'GET_TABS':
      return { ok: true, groups: await buildSnapshot() };

    case 'ACTIVATE_TAB': {
      // 先聚焦窗口，再激活标签，顺序反了在部分平台会失效
      await chrome.windows.update(msg.windowId, { focused: true });
      await chrome.tabs.update(msg.tabId, { active: true });
      return { ok: true };
    }

    case 'CLOSE_TAB':
      await chrome.tabs.remove(msg.tabId);
      return { ok: true };

    case 'PANEL_OPENED':
      if (sender.tab?.id != null) panelTabs.add(sender.tab.id);
      return { ok: true };

    case 'PANEL_CLOSED':
      if (sender.tab?.id != null) panelTabs.delete(sender.tab.id);
      return { ok: true };

    case 'GET_SHORTCUT': {
      // 扩展无法用代码设置自己的快捷键，只能读实际生效的那个
      const commands = await chrome.commands.getAll();
      const toggle = commands.find((c) => c.name === 'toggle-panel');
      return { ok: true, shortcut: toggle?.shortcut ?? '' };
    }

    case 'OPEN_SHORTCUTS_PAGE':
      // chrome:// 页面只能由扩展自己打开，content script 无权跳转
      await chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
      return { ok: true };

    default:
      return { ok: false, error: '未知的请求类型' };
  }
}
