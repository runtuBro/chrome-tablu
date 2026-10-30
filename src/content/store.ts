import { create } from 'zustand';
import {
  DEFAULT_SETTINGS,
  STORAGE_KEYS,
  type HeightMode,
  type Lang,
  type Settings,
  type SortMode,
  type TabItem,
  type ThemeMode,
  type WindowGroup,
} from '../shared/types';
import type { Request, Response } from '../shared/protocol';

/** 扩展上下文失效（重新加载扩展、页面未刷新）时不要让 UI 直接崩掉 */
async function safeSend(msg: Request): Promise<Response> {
  try {
    if (!chrome.runtime?.id) {
      return { ok: false, error: '扩展已重新加载，请刷新当前页面后再试' };
    }
    return (await chrome.runtime.sendMessage(msg)) as Response;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : '与后台通信失败，请刷新页面',
    };
  }
}

type Store = {
  visible: boolean;
  /** 面板当前显示哪个视图 */
  view: 'list' | 'settings';
  loading: boolean;
  groups: WindowGroup[];
  /** 被折叠的窗口 id */
  collapsed: number[];
  /**
   * 标签组的折叠覆盖值。没记录过的组跟随 Chrome 自己的折叠状态，
   * 用户在这里点过之后就按用户的来。
   */
  groupOverride: Record<number, boolean>;
  notice: string | null;
  settings: Settings;
  /** 设置是否已从 storage 读出来（避免首帧用默认值闪一下） */
  settingsReady: boolean;
  /** url → bookmarkId，用于判断标签是否已收藏 */
  bookmarks: Record<string, string>;

  setVisible: (v: boolean) => void;
  setView: (v: 'list' | 'settings') => void;
  setTheme: (t: ThemeMode) => void;
  setLanguage: (l: Lang) => void;
  setHeightMode: (h: HeightMode) => void;
  setSortMode: (s: SortMode) => void;
  loadSettings: () => Promise<void>;
  loadBookmarks: () => Promise<void>;
  toggleBookmark: (tab: TabItem) => Promise<void>;
  toggle: () => void;
  setGroups: (groups: WindowGroup[]) => void;
  toggleWindow: (windowId: number) => void;
  toggleGroup: (groupId: number, current: boolean) => void;
  refresh: () => Promise<void>;
  activateTab: (tabId: number, windowId: number) => Promise<void>;
  closeTab: (tabId: number) => Promise<void>;
  setNotice: (n: string | null) => void;
};

export const useStore = create<Store>((set, get) => ({
  visible: false,
  view: 'list',
  loading: false,
  groups: [],
  collapsed: [],
  groupOverride: {},
  notice: null,
  settings: DEFAULT_SETTINGS,
  settingsReady: false,
  bookmarks: {},

  setVisible(v) {
    set({ visible: v });
    if (v) {
      void safeSend({ type: 'PANEL_OPENED' });
      void get().refresh();
      void get().loadBookmarks();
    } else {
      void safeSend({ type: 'PANEL_CLOSED' });
      // 关闭时重置临时状态，下次打开是干净的
      set({ notice: null, view: 'list' });
    }
  },

  setView(v) {
    set({ view: v });
  },

  setTheme(theme) {
    const settings: Settings = { ...get().settings, theme };
    set({ settings });
    chrome.storage?.local?.set({ [STORAGE_KEYS.settings]: settings }).catch(() => {});
  },

  setLanguage(language) {
    const settings: Settings = { ...get().settings, language };
    set({ settings });
    chrome.storage?.local?.set({ [STORAGE_KEYS.settings]: settings }).catch(() => {});
  },

  setHeightMode(heightMode) {
    const settings: Settings = { ...get().settings, heightMode };
    set({ settings });
    chrome.storage?.local?.set({ [STORAGE_KEYS.settings]: settings }).catch(() => {});
  },

  setSortMode(sortMode) {
    const settings: Settings = { ...get().settings, sortMode };
    set({ settings });
    chrome.storage?.local?.set({ [STORAGE_KEYS.settings]: settings }).catch(() => {});
  },

  async loadSettings() {
    try {
      const stored = await chrome.storage?.local?.get(STORAGE_KEYS.settings);
      const saved = stored?.[STORAGE_KEYS.settings] as Partial<Settings> | undefined;
      set({ settings: { ...DEFAULT_SETTINGS, ...saved }, settingsReady: true });
    } catch {
      set({ settingsReady: true });
    }
  },

  async loadBookmarks() {
    const res = await safeSend({ type: 'GET_BOOKMARKS' });
    if (res.ok && res.bookmarks) set({ bookmarks: res.bookmarks });
  },

  async toggleBookmark(tab) {
    const existing = get().bookmarks[tab.url];

    // 已收藏 → 移除
    if (existing) {
      const res = await safeSend({ type: 'REMOVE_BOOKMARK', id: existing });
      if (res.ok) {
        const next = { ...get().bookmarks };
        delete next[tab.url];
        set({ bookmarks: next });
      } else {
        set({ notice: res.error });
      }
      return;
    }

    // 未收藏 → 添加
    const res = await safeSend({
      type: 'ADD_BOOKMARK',
      url: tab.url,
      title: tab.title || tab.url,
    });
    if (res.ok && res.bookmarkId) {
      set({ bookmarks: { ...get().bookmarks, [tab.url]: res.bookmarkId } });
    } else if (!res.ok) {
      set({ notice: res.error });
    }
  },

  toggle() {
    get().setVisible(!get().visible);
  },

  setGroups(groups) {
    set({ groups, loading: false });
  },

  toggleWindow(windowId) {
    set((s) => ({
      collapsed: s.collapsed.includes(windowId)
        ? s.collapsed.filter((id) => id !== windowId)
        : [...s.collapsed, windowId],
    }));
  },

  toggleGroup(groupId, current) {
    set((s) => ({ groupOverride: { ...s.groupOverride, [groupId]: !current } }));
  },

  async refresh() {
    set({ loading: true });
    const res = await safeSend({ type: 'GET_TABS' });
    if (res.ok && res.groups) {
      set({ groups: res.groups, loading: false, notice: null });
    } else {
      set({ loading: false, notice: res.ok ? null : res.error });
    }
  },

  async activateTab(tabId, windowId) {
    const res = await safeSend({ type: 'ACTIVATE_TAB', tabId, windowId });
    if (res.ok) get().setVisible(false);
    else set({ notice: res.error });
  },

  async closeTab(tabId) {
    const res = await safeSend({ type: 'CLOSE_TAB', tabId });
    if (!res.ok) set({ notice: res.error });
  },

  setNotice(n) {
    set({ notice: n });
  },
}));
