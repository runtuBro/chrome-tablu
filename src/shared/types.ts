/** 跨上下文共用的数据模型（纯展示，无持久化） */

/** Chrome 的标签组颜色枚举，与 chrome.tabGroups.Color 一致 */
export type TabGroupColor =
  | 'grey'
  | 'blue'
  | 'red'
  | 'yellow'
  | 'green'
  | 'pink'
  | 'purple'
  | 'cyan'
  | 'orange';

/** 未分组的标签，chrome.tabGroups.TAB_GROUP_ID_NONE 就是 -1 */
export const NO_GROUP = -1;

export type TabGroupInfo = {
  id: number;
  title: string;
  color: TabGroupColor;
  /** Chrome 里这个组是否处于折叠状态 */
  collapsed: boolean;
};

export type TabItem = {
  id: number;
  windowId: number;
  index: number;
  title: string;
  url: string;
  favIconUrl?: string;
  active: boolean;
  pinned: boolean;
  audible: boolean;
  discarded: boolean;
  /** 所属标签组 id，未分组为 -1 */
  groupId: number;
  /** 最近访问时间戳，Chrome 121+ 提供；不可用时为 0 */
  lastAccessed: number;
};

export type WindowGroup = {
  windowId: number;
  focused: boolean;
  tabs: TabItem[];
  /** 该窗口内的标签组，按组内首个标签的位置排序 */
  groups: TabGroupInfo[];
};

/** 组颜色的色块样式，组头和组内竖条共用 */
export const GROUP_COLOR_CLASS: Record<TabGroupColor, string> = {
  grey: 'bg-slate-400',
  blue: 'bg-blue-500',
  red: 'bg-red-500',
  yellow: 'bg-amber-400',
  green: 'bg-emerald-500',
  pink: 'bg-pink-500',
  purple: 'bg-violet-500',
  cyan: 'bg-cyan-500',
  orange: 'bg-orange-500',
};

/* ---------- 设置 ---------- */

export type ThemeMode = 'system' | 'light' | 'dark';
export type Lang = 'zh' | 'en';
export type HeightMode = 'auto' | 'fixed';
export type SortMode = 'default' | 'recent';

export type Settings = {
  theme: ThemeMode;
  language: Lang;
  heightMode: HeightMode;
  sortMode: SortMode;
};

export const DEFAULT_SETTINGS: Settings = {
  theme: 'system',
  language: 'zh',
  heightMode: 'auto',
  sortMode: 'default',
};

export const STORAGE_KEYS = {
  settings: 'tablu.settings',
} as const;

/** 从 URL 里取一个可读的域名，取不到就原样返回 */
export function hostOf(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === 'chrome:' || u.protocol === 'chrome-extension:') {
      return u.hostname || u.protocol.replace(':', '');
    }
    if (u.protocol === 'file:') return '本地文件';
    return u.hostname.replace(/^www\./, '') || url;
  } catch {
    return url;
  }
}

/** 统计口径统一走这里，避免各处重复 reduce */
export function countTabs(groups: WindowGroup[]): number {
  return groups.reduce((n, g) => n + g.tabs.length, 0);
}
