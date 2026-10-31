/**
 * 极简 i18n：一个字典 + 一个 t() 函数。
 *
 * 没引入 i18next 之类的库——文案量只有几十条，一个对象足够，
 * 还能避免为切换语言增加 20KB 运行时。
 */
import type { Lang } from './types';

const dict = {
  zh: {
    // 通用
    settings: '设置',
    back: '返回列表',
    cancel: '取消',

    // 顶部栏与列表
    windowN: '窗口 {n}',
    current: '当前',
    untitledGroup: '未命名组',
    jumpToGroup: '跳转到「{name}」',
    toggleGroup: '点击折叠 / 展开',
    noTabs: '当前没有打开的标签页',
    loadingTabs: '正在读取标签页…',
    closeTab: '关闭此标签页',
    bookmark: '收藏此标签页',
    unbookmark: '取消收藏',

    // 外观
    appearance: '外观',
    themeSystem: '跟随系统',
    themeLight: '浅色',
    themeDark: '深色',
    language: '语言',
    langZh: '中文',
    langEn: 'English',

    // 面板高度
    panelHeight: '面板高度',
    heightAuto: '自适应',
    heightFixed: '固定',
    heightHint: '自适应会按标签数量收缩，固定则始终占满最大高度。',

    // 排序
    sorting: '排序',
    sortDefault: '标签栏顺序',
    sortRecent: '最近打开',
    sortHint: '「最近打开」在每个窗口和标签组内部按访问时间排序，不改变分组结构。',

    // 快捷键
    shortcut: '快捷键',
    openClosePanel: '打开 / 关闭面板',
    shortcutActive: '当前已生效',
    shortcutMissing: '未设置 · 可能与其他扩展或系统快捷键冲突',
    change: '修改',
    shortcutHint: '点击「修改」会打开 Chrome 自带的快捷键页面，在那里给 Tablu 指定组合键。',

    // 关于
    about: '关于',
    privacy: '所有逻辑在本地运行，代码中没有任何网络请求。标签页信息不会离开这台设备。',
  },

  en: {
    settings: 'Settings',
    back: 'Back to list',
    cancel: 'Cancel',

    windowN: 'Window {n}',
    current: 'Current',
    untitledGroup: 'Untitled group',
    jumpToGroup: 'Jump to "{name}"',
    toggleGroup: 'Click to collapse / expand',
    noTabs: 'No tabs open',
    loadingTabs: 'Reading tabs…',
    closeTab: 'Close tab',
    bookmark: 'Bookmark this tab',
    unbookmark: 'Remove bookmark',

    appearance: 'Appearance',
    themeSystem: 'System',
    themeLight: 'Light',
    themeDark: 'Dark',
    language: 'Language',
    langZh: '中文',
    langEn: 'English',

    panelHeight: 'Panel height',
    heightAuto: 'Auto',
    heightFixed: 'Fixed',
    heightHint: 'Auto shrinks to fit the tab count; Fixed always uses the maximum height.',

    sorting: 'Sorting',
    sortDefault: 'Tab bar order',
    sortRecent: 'Recently opened',
    sortHint:
      'Recently opened sorts tabs by access time within each window and tab group, without changing the grouping.',

    shortcut: 'Shortcut',
    openClosePanel: 'Open / close panel',
    shortcutActive: 'Active',
    shortcutMissing: 'Not set · may conflict with another extension or system shortcut',
    change: 'Change',
    shortcutHint:
      'Click "Change" to open Chrome\'s shortcut page and assign a key combination.',

    about: 'About',
    privacy:
      'Everything runs locally. There are no network requests in the code, and tab information never leaves this device.',
  },
} as const;

export type MessageKey = keyof (typeof dict)['zh'];

export function t(
  lang: Lang,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const table = dict[lang] ?? dict.zh;
  let s: string = table[key] ?? dict.zh[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(`{${k}}`, String(v));
    }
  }
  return s;
}
