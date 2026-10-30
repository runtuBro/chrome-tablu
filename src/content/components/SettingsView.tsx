import { useEffect, useState } from 'react';
import { ChevronLeft, X, ExternalLink, Keyboard, Monitor, Sun, Moon } from 'lucide-react';
import { useStore } from '../store';
import type { ThemeMode } from '../../shared/types';

/**
 * 把 Chrome 返回的快捷键串格式化成好读的样子。
 *
 * 注意 Chrome 的返回值有两种形态：
 *  - 英文环境："Alt+Space"
 *  - macOS 中文环境："⌥空格键"（已符号化，键名被本地化，且没有分隔符）
 * 两种都要处理，否则会显示出中英混排的怪东西。
 */
function formatShortcut(raw: string): string {
  if (!raw) return '';

  if (/[⌘⌥⌃⇧]/.test(raw)) {
    return raw
      .replace(/([⌘⌥⌃⇧])/g, '$1 ')
      .replace(/空格键?/g, 'Space')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const isMac = /Mac/i.test(navigator.platform || '');
  const parts = raw.split('+').map((k) => {
    if (!isMac) return k;
    switch (k) {
      case 'Alt':
        return '⌥';
      case 'Command':
        return '⌘';
      case 'Ctrl':
      case 'MacCtrl':
        return '⌃';
      case 'Shift':
        return '⇧';
      case 'Space':
        return 'Space';
      default:
        return k;
    }
  });
  return parts.join(isMac ? ' ' : ' + ');
}

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
];

export function SettingsView({
  onBack,
  onClose,
}: {
  onBack: () => void;
  onClose: () => void;
}) {
  const theme = useStore((s) => s.settings.theme);
  const setTheme = useStore((s) => s.setTheme);

  const [shortcut, setShortcut] = useState<string | null>(null);
  const [version, setVersion] = useState('');

  useEffect(() => {
    setVersion(chrome.runtime.getManifest().version);

    let alive = true;
    (async () => {
      try {
        const res = (await chrome.runtime.sendMessage({ type: 'GET_SHORTCUT' })) as
          | { ok: true; shortcut?: string }
          | { ok: false; error: string };
        if (alive) setShortcut(res.ok ? (res.shortcut ?? '') : '');
      } catch {
        if (alive) setShortcut('');
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  const openShortcutsPage = async () => {
    try {
      await chrome.runtime.sendMessage({ type: 'OPEN_SHORTCUTS_PAGE' });
    } catch {
      /* 后台未响应，用户可手动去 chrome://extensions/shortcuts */
    }
  };

  const active = Boolean(shortcut);

  return (
    <>
      <div className="flex shrink-0 items-center gap-1 border-b border-hairline px-2.5 py-2.5">
        <button
          type="button"
          onClick={onBack}
          title="返回列表"
          className="rounded-lg p-2 text-ink-500 transition hover:bg-hoverstrong hover:text-ink-900"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-[13px] font-medium text-ink-900">设置</span>
        <button
          type="button"
          onClick={onClose}
          title="关闭 (Esc)"
          className="ml-auto rounded-lg p-2 text-ink-500 transition hover:bg-hoverstrong hover:text-ink-900"
        >
          <X size={16} />
        </button>
      </div>

      <div className="tm-scroll min-h-0 flex-1 overflow-y-auto p-5">
        {/* 外观 */}
        <h3 className="mb-2 text-[12px] font-medium text-ink-500">外观</h3>
        <div className="rounded-xl bg-fieldbg p-1 ring-1 ring-hairline">
          <div className="flex gap-1">
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => {
              const selected = theme === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTheme(value)}
                  className={[
                    'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[12px] transition',
                    selected
                      ? 'bg-brand-500 font-medium text-white shadow-sm'
                      : 'text-ink-700 hover:bg-hoverbg hover:text-ink-900',
                  ].join(' ')}
                >
                  <Icon size={13} />
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* 快捷键 */}
        <h3 className="mb-2 mt-6 flex items-center gap-1.5 text-[12px] font-medium text-ink-500">
          <Keyboard size={12} />
          快捷键
        </h3>

        <div className="flex items-center gap-3 rounded-xl bg-fieldbg px-4 py-3 ring-1 ring-hairline">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-ink-900">打开 / 关闭面板</div>
            <div className="mt-0.5 text-[11px] text-ink-500">
              {shortcut === null
                ? '读取中…'
                : active
                  ? '当前已生效'
                  : '未设置 · 可能与其他扩展或系统快捷键冲突'}
            </div>
          </div>

          {active && (
            <kbd className="shrink-0 rounded-md bg-hoverbg px-2 py-1 text-[12px] font-medium text-ink-700 ring-1 ring-hairline">
              {formatShortcut(shortcut as string)}
            </kbd>
          )}

          <button
            type="button"
            onClick={() => void openShortcutsPage()}
            className="flex shrink-0 items-center gap-1 rounded-lg bg-brand-500 px-2.5 py-1.5 text-[12px] font-medium text-white transition hover:bg-brand-600"
          >
            修改
            <ExternalLink size={11} />
          </button>
        </div>

        <p className="mt-2.5 text-[11px] leading-relaxed text-ink-500">
          点击「修改」会打开 Chrome 自带的快捷键页面，在那里给 TabMind 指定组合键。
          <br />
          扩展无法用代码设置自己的快捷键——这是 Chrome 的限制，所有扩展都一样。
        </p>

        {/* 关于 */}
        <h3 className="mb-2 mt-6 text-[12px] font-medium text-ink-500">关于</h3>
        <div className="rounded-xl bg-fieldbg px-4 py-3 text-[12px] text-ink-700 ring-1 ring-hairline">
          <div className="flex items-center justify-between">
            <span>TabMind</span>
            <span className="tabular-nums text-ink-500">v{version}</span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-500">
            所有逻辑在本地运行，代码中没有任何网络请求。标签页信息不会离开这台设备。
          </p>
        </div>
      </div>
    </>
  );
}
