/**
 * content ⇄ background 的消息协议。
 * 所有跨上下文通信的类型都从这里取，避免两边字符串拼错。
 */
import type { WindowGroup } from './types';

/* ---------- content → background（一次性请求） ---------- */

export type Request =
  | { type: 'GET_TABS' }
  | { type: 'ACTIVATE_TAB'; tabId: number; windowId: number }
  | { type: 'CLOSE_TAB'; tabId: number }
  | { type: 'PANEL_OPENED' }
  | { type: 'PANEL_CLOSED' }
  | { type: 'GET_SHORTCUT' }
  | { type: 'OPEN_SHORTCUTS_PAGE' }
  | { type: 'GET_BOOKMARKS' }
  | { type: 'ADD_BOOKMARK'; url: string; title: string }
  | { type: 'REMOVE_BOOKMARK'; id: string };

export type Response =
  | {
      ok: true;
      groups?: WindowGroup[];
      shortcut?: string;
      /** url → bookmarkId 的映射，用于判断某标签是否已收藏 */
      bookmarks?: Record<string, string>;
      bookmarkId?: string;
    }
  | { ok: false; error: string };

/* ---------- background → content（广播 / 指令） ---------- */

export type BackgroundMessage =
  | { type: 'TABS_SNAPSHOT'; groups: WindowGroup[] }
  | { type: 'TOGGLE_PANEL' }
  | { type: 'OPEN_PANEL' };
