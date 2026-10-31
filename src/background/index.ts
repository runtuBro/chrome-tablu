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
import { PANEL_PORT, type PortMessage, type Request, type Response } from '../shared/protocol';

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

  // 独立面板页本身也是标签页，但它不该出现在自己的列表里
  const ownPanelUrl = chrome.runtime.getURL('panel.html');

  for (const t of tabs) {
    if (t.id == null || t.windowId == null) continue;
    if (t.url === ownPanelUrl) continue;
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
      lastAccessed: typeof t.lastAccessed === 'number' ? t.lastAccessed : 0,
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
 * 广播：走长连接 Port，而不是 tabs.sendMessage
 *
 * 为什么必须用 Port：
 * MV3 的 service worker 空闲 30 秒会被回收，模块级变量（比如"哪些标签页
 * 开着面板"这份登记）随之消失。回收后广播发不出去，面板看起来一切正常，
 * 内容却停在几分钟前——不报错，用户只能靠自己发现。
 *
 * Port 会在 SW 回收时自动断开，content script 立刻感知并重连，
 * 重连时这里主动推一份最新快照。用户看到的只是列表自己刷新了一下。
 * ------------------------------------------------------------------ */

const panelPorts = new Map<number, chrome.runtime.Port>();
let broadcastTimer: ReturnType<typeof setTimeout> | null = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PANEL_PORT) return;
  const tabId = port.sender?.tab?.id;
  if (tabId == null) return;

  panelPorts.set(tabId, port);
  port.onDisconnect.addListener(() => {
    // 只删自己：重连过程中新 port 可能已经登记上来了
    if (panelPorts.get(tabId) === port) panelPorts.delete(tabId);
  });

  // 连上就推一份，重连后的第一帧不依赖任何用户操作
  void buildSnapshot().then((groups) => {
    try {
      port.postMessage({ type: 'TABS_SNAPSHOT', groups } satisfies PortMessage);
    } catch {
      /* 已经断开，onDisconnect 会处理 */
    }
  });
});

function postToPanels(groups: WindowGroup[]): void {
  for (const [tabId, port] of [...panelPorts]) {
    try {
      port.postMessage({ type: 'TABS_SNAPSHOT', groups } satisfies PortMessage);
    } catch {
      panelPorts.delete(tabId);
    }
  }
}

function scheduleBroadcast(): void {
  if (broadcastTimer) clearTimeout(broadcastTimer);
  broadcastTimer = setTimeout(async () => {
    broadcastTimer = null;
    if (panelPorts.size === 0) return;
    postToPanels(await buildSnapshot());
  }, 180);
}

chrome.tabs.onCreated.addListener(scheduleBroadcast);
chrome.tabs.onActivated.addListener(scheduleBroadcast);
chrome.tabs.onMoved.addListener(scheduleBroadcast);
chrome.tabs.onAttached.addListener(scheduleBroadcast);
chrome.tabs.onDetached.addListener(scheduleBroadcast);
chrome.tabs.onReplaced.addListener(scheduleBroadcast);
chrome.tabs.onRemoved.addListener((tabId) => {
  panelPorts.delete(tabId);
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

  // ③ 注入不了（chrome:// 这类页面）→ 改为打开独立面板页。
  //    扩展页面本身就是扩展的一部分，不受注入限制，也不需要额外权限。
  //    往新开的普通网页注入是不行的：activeTab 只授权点击时所在的那个标签页。
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL('panel.html') });
    return;
  } catch {
    // 连新标签页都开不了，只能退回到图标提示
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

/** 按页面类型给出具体原因，而不是一句笼统的"不支持" */
async function unsupportedReason(tabId: number): Promise<string> {
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url ?? '';

    if (url.startsWith('chrome://')) return '浏览器内部页面不支持扩展注入';
    if (url.startsWith('chrome-extension://')) return '扩展页面不支持注入';
    if (url.includes('chromewebstore.google.com') || url.includes('chrome.google.com/webstore')) {
      return 'Chrome 应用商店页面不支持扩展注入';
    }
    if (url.startsWith('file://')) return '本地文件需先在扩展详情开启「允许访问文件网址」';
    if (url.startsWith('about:')) return '空白页不支持扩展注入';

    return '页面脚本未能加载，试试刷新后重试';
  } catch {
    return '无法在此页面显示面板';
  }
}

async function flashUnsupported(tabId: number): Promise<void> {
  const reason = await unsupportedReason(tabId);
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#ef4444' });
    await chrome.action.setBadgeText({ tabId, text: '!' });
    await chrome.action.setTitle({ tabId, title: `Tablu 无法打开：${reason}` });
    setTimeout(() => {
      chrome.action.setBadgeText({ tabId, text: '' }).catch(() => {});
      chrome.action.setTitle({ tabId, title: '打开 Tablu 面板' }).catch(() => {});
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

    case 'GET_BOOKMARKS': {
      // 一次性拉全量书签并压成 url → id 的映射，避免每行单独查询
      const tree = await chrome.bookmarks.getTree();
      const map: Record<string, string> = {};
      const walk = (nodes: chrome.bookmarks.BookmarkTreeNode[]) => {
        for (const n of nodes) {
          if (n.url && !map[n.url]) map[n.url] = n.id;
          if (n.children?.length) walk(n.children);
        }
      };
      walk(tree);
      return { ok: true, bookmarks: map };
    }

    case 'ADD_BOOKMARK': {
      // 不指定 parentId 时 Chrome 默认放到「其他书签」
      const node = await chrome.bookmarks.create({ title: msg.title, url: msg.url });
      return { ok: true, bookmarkId: node.id };
    }

    case 'REMOVE_BOOKMARK':
      await chrome.bookmarks.remove(msg.id);
      return { ok: true };

    default:
      return { ok: false, error: '未知的请求类型' };
  }
}
