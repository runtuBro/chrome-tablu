/**
 * 面板 ↔ background 的长连接通道
 *
 * 为什么不用一次性 sendMessage 收广播：
 * MV3 的 service worker 空闲 30 秒会被回收，background 里「哪些标签页开着
 * 面板」的登记也随之消失。回收之后广播发不出去，面板看着正常、内容却是旧的，
 * 而且没有任何报错——用户只能靠自己发现列表不对。
 *
 * 换成 Port 后，SW 被回收时 Port 自动断开，这里立刻感知并重连；
 * background 在 onConnect 里会主动推一份最新快照，所以重连后不需要
 * 任何用户操作，列表就自己刷新回来了。
 *
 * 这里不直接 import store，而是由调用方传入回调——否则 store 与
 * panelChannel 会互相 import 形成循环依赖。
 */
import { PANEL_PORT, type PortMessage } from '../shared/protocol';
import type { WindowGroup } from '../shared/types';

let port: chrome.runtime.Port | null = null;
/** 面板是否应当保持连接。关闭面板时置 false，重连循环随之停止 */
let wanted = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 200;
let onSnapshot: ((groups: WindowGroup[]) => void) | null = null;

function clearRetry(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleReconnect(): void {
  clearRetry();
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (wanted) connect();
  }, retryDelay);
  // 退避：200ms → 400 → 800 → 上限 2s，避免 SW 反复重启时打转
  retryDelay = Math.min(retryDelay * 2, 2000);
}

function connect(): void {
  if (port) return;

  let p: chrome.runtime.Port;
  try {
    p = chrome.runtime.connect({ name: PANEL_PORT });
  } catch {
    // 扩展被重载/卸载时 connect 会抛，重试几次仍失败就静默放弃
    scheduleReconnect();
    return;
  }

  port = p;
  retryDelay = 200; // 连上就重置退避

  p.onMessage.addListener((msg: PortMessage) => {
    if (msg?.type === 'TABS_SNAPSHOT') onSnapshot?.(msg.groups);
  });

  p.onDisconnect.addListener(() => {
    // 读一下 lastError，消掉控制台的 "Unchecked runtime.lastError"
    void chrome.runtime.lastError;
    if (port === p) port = null;
    if (wanted) scheduleReconnect();
  });
}

/** 面板打开时调用：建立（或复用）连接 */
export function connectPanelChannel(handler: (groups: WindowGroup[]) => void): void {
  onSnapshot = handler;
  wanted = true;
  retryDelay = 200;
  connect();
}

/** 面板关闭时调用：断开连接，background 那边同步注销 */
export function disconnectPanelChannel(): void {
  wanted = false;
  clearRetry();
  if (port) {
    const p = port;
    port = null;
    try {
      p.disconnect();
    } catch {
      /* 已经断了 */
    }
  }
}
