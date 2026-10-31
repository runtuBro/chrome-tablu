import { useEffect, useState } from 'react';
import { ChevronLeft, X, ExternalLink, Keyboard, Monitor, Sun, Moon } from 'lucide-react';
import { useStore } from '../store';
import { t, type MessageKey } from '../../shared/i18n';
import type { HeightMode, Lang, SortMode, ThemeMode } from '../../shared/types';

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

/** 分段选择器：主题、语言、高度、排序共用同一套外观 */
function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string; icon?: typeof Sun }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="rounded-lg bg-fieldbg p-1 ring-1 ring-hairline">
      <div className="flex gap-1">
        {options.map(({ value: v, label, icon: Icon }) => {
          const selected = value === v;
          return (
            <button
              key={v}
              type="button"
              onClick={() => onChange(v)}
              className={[
                'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[12px] transition',
                selected
                  ? 'bg-brand-500 font-medium text-white shadow-sm'
                  : 'text-ink-700 hover:bg-hoverbg hover:text-ink-900',
              ].join(' ')}
            >
              {Icon && <Icon size={13} />}
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function SettingsView({
  onBack,
  onClose,
}: {
  onBack: () => void;
  onClose: () => void;
}) {
  const theme = useStore((s) => s.settings.theme);
  const language = useStore((s) => s.settings.language);
  const heightMode = useStore((s) => s.settings.heightMode);
  const sortMode = useStore((s) => s.settings.sortMode);
  const setTheme = useStore((s) => s.setTheme);
  const setLanguage = useStore((s) => s.setLanguage);
  const setHeightMode = useStore((s) => s.setHeightMode);
  const setSortMode = useStore((s) => s.setSortMode);

  const tr = (key: MessageKey, vars?: Record<string, string | number>) =>
    t(language, key, vars);

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
          title={tr('back')}
          className="rounded-lg p-2 text-ink-500 transition hover:bg-hoverstrong hover:text-ink-900"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-[13px] font-medium text-ink-900">{tr('settings')}</span>
        <button
          type="button"
          onClick={onClose}
          title="Esc"
          className="ml-auto rounded-lg p-2 text-ink-500 transition hover:bg-hoverstrong hover:text-ink-900"
        >
          <X size={16} />
        </button>
      </div>

      <div className="tm-scroll min-h-0 flex-1 overflow-y-auto p-5">
        {/* 外观 */}
        <h3 className="mb-2 text-[12px] font-medium text-ink-500">{tr('appearance')}</h3>
        <Segmented<ThemeMode>
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'system', label: tr('themeSystem'), icon: Monitor },
            { value: 'light', label: tr('themeLight'), icon: Sun },
            { value: 'dark', label: tr('themeDark'), icon: Moon },
          ]}
        />

        {/* 语言 */}
        <h3 className="mb-2 mt-6 text-[12px] font-medium text-ink-500">{tr('language')}</h3>
        <Segmented<Lang>
          value={language}
          onChange={setLanguage}
          options={[
            { value: 'zh', label: tr('langZh') },
            { value: 'en', label: tr('langEn') },
          ]}
        />

        {/* 面板高度 */}
        <h3 className="mb-2 mt-6 text-[12px] font-medium text-ink-500">{tr('panelHeight')}</h3>
        <Segmented<HeightMode>
          value={heightMode}
          onChange={setHeightMode}
          options={[
            { value: 'auto', label: tr('heightAuto') },
            { value: 'fixed', label: tr('heightFixed') },
          ]}
        />
        <p className="mt-2 text-[11px] leading-relaxed text-ink-500">{tr('heightHint')}</p>

        {/* 排序 */}
        <h3 className="mb-2 mt-6 text-[12px] font-medium text-ink-500">{tr('sorting')}</h3>
        <Segmented<SortMode>
          value={sortMode}
          onChange={setSortMode}
          options={[
            { value: 'default', label: tr('sortDefault') },
            { value: 'recent', label: tr('sortRecent') },
          ]}
        />
        <p className="mt-2 text-[11px] leading-relaxed text-ink-500">{tr('sortHint')}</p>

        {/* 快捷键 */}
        <h3 className="mb-2 mt-6 flex items-center gap-1.5 text-[12px] font-medium text-ink-500">
          <Keyboard size={12} />
          {tr('shortcut')}
        </h3>

        <div className="flex items-center gap-3 rounded-lg bg-fieldbg px-4 py-3 ring-1 ring-hairline">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] text-ink-900">{tr('openClosePanel')}</div>
            <div className="mt-0.5 text-[11px] text-ink-500">
              {shortcut === null
                ? '…'
                : active
                  ? tr('shortcutActive')
                  : tr('shortcutMissing')}
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
            {tr('change')}
            <ExternalLink size={11} />
          </button>
        </div>

        <p className="mt-2.5 text-[11px] leading-relaxed text-ink-500">{tr('shortcutHint')}</p>

        {/* 关于 */}
        <h3 className="mb-2 mt-6 text-[12px] font-medium text-ink-500">{tr('about')}</h3>
        <div className="rounded-lg bg-fieldbg px-4 py-3 text-[12px] text-ink-700 ring-1 ring-hairline">
          <div className="flex items-center justify-between">
            <span>Tablu</span>
            <span className="tabular-nums text-ink-500">v{version}</span>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-500">{tr('privacy')}</p>
        </div>
      </div>
    </>
  );
}
