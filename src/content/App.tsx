import { useEffect, useState } from 'react';
import { useStore } from './store';
import { TabList } from './components/TabList';
import { SettingsView } from './components/SettingsView';
import type { ThemeMode } from '../shared/types';

/** 把 'system' 解析成实际生效的明/暗，并跟随系统切换 */
function useResolvedTheme(mode: ThemeMode): 'light' | 'dark' {
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => {
    if (mode !== 'system') return mode;
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });

  useEffect(() => {
    if (mode !== 'system') {
      setResolved(mode);
      return;
    }
    let mq: MediaQueryList;
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      setResolved('light');
      return;
    }
    const apply = () => setResolved(mq.matches ? 'dark' : 'light');
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [mode]);

  return resolved;
}

export function App() {
  const visible = useStore((s) => s.visible);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const setVisible = useStore((s) => s.setVisible);
  const notice = useStore((s) => s.notice);
  const setNotice = useStore((s) => s.setNotice);
  const themeMode = useStore((s) => s.settings.theme);
  const resolvedTheme = useResolvedTheme(themeMode);

  // Esc 关闭：用捕获阶段，避免被页面自己的快捷键拦下。
  // 在设置视图里，Esc 先退回列表，再按一次才关闭。
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      if (useStore.getState().view === 'settings') setView('list');
      else setVisible(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [visible, setView, setVisible]);

  // 打开时清掉上一次的临时提示
  useEffect(() => {
    if (visible) setNotice(null);
  }, [visible, setNotice]);

  if (!visible) return null;

  return (
    <div
      className="tm-overlay tm-anim animate-fadeIn"
      data-theme={resolvedTheme}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setVisible(false);
      }}
    >
      <div
        className="tm-anim animate-panelIn tm-glass-sheen tm-panel flex max-h-[min(660px,88vh)] min-h-[200px] w-[min(880px,92vw)] flex-col overflow-hidden rounded-xl bg-surface backdrop-blur-lg backdrop-saturate-150"
        role="dialog"
        aria-modal="true"
        aria-label="标签页总览"
      >
        {view === 'settings' ? (
          <SettingsView onBack={() => setView('list')} onClose={() => setVisible(false)} />
        ) : (
          <TabList
            onClose={() => setVisible(false)}
            onOpenSettings={() => setView('settings')}
          />
        )}

        {notice && (
          <div className="shrink-0 border-t border-hairline bg-amber-500/15 px-5 py-2 text-xs text-amber-600">
            {notice}
          </div>
        )}
      </div>
    </div>
  );
}
