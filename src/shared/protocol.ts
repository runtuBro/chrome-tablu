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

/* ---------- background → content（指令，走 sendMessage） ---------- */

export type BackgroundMessage = { type: 'TOGGLE_PANEL' } | { type: 'OPEN_PANEL' };

/* ---------- 长连接 Port ---------- */

/** 面板快照通道的 port 名，两侧共用，避免拼错 */
export const PANEL_PORT = 'tabmind-panel';

/** Port 上传输的消息（与一次性 sendMessage 的响应区分开） */
export type PortMessage = { type: 'TABS_SNAPSHOT'; groups: WindowGroup[] };
