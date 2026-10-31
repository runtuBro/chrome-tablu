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

/**
 * 面板外壳。
 *
 * standalone = true 时用于独立页面（panel.html）：铺满视口、没有遮罩、
 * 不响应"点外部关闭"。内容与交互完全一致，只是外壳不同。
 */
export function App({ standalone = false }: { standalone?: boolean }) {
  const visible = useStore((s) => s.visible);
  const view = useStore((s) => s.view);
  const setView = useStore((s) => s.setView);
  const setVisible = useStore((s) => s.setVisible);
  const notice = useStore((s) => s.notice);
  const setNotice = useStore((s) => s.setNotice);
  const themeMode = useStore((s) => s.settings.theme);
  const heightMode = useStore((s) => s.settings.heightMode);
  const resolvedTheme = useResolvedTheme(themeMode);

  // Esc 关闭：用捕获阶段，避免被页面自己的快捷键拦下。
  // 在设置视图里，Esc 先退回列表，再按一次才关闭。
  // 独立页里"关闭"= 关闭标签页，由 panel/index.tsx 订阅 visible 处理。
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

  const panelSize = standalone
    ? // 页面模式：始终占满可用高度，不受"面板高度"设置影响
      // （页面上留白会显得像加载失败）
      'h-[calc(100vh-48px)] w-full max-w-[845px]'
    : [
        'w-[min(845px,92vw)]',
        heightMode === 'fixed'
          ? 'h-[min(660px,88vh)]'
          : 'max-h-[min(660px,88vh)] min-h-[200px]',
      ].join(' ');

  return (
    <div
      className={
        standalone
          ? 'tm-overlay tm-page is-open'
          : `tm-overlay${visible ? ' is-open' : ''}`
      }
      data-theme={resolvedTheme}
      onMouseDown={(e) => {
        if (standalone) return;
        if (e.target === e.currentTarget) setVisible(false);
      }}
    >
      <div
        className={[
          'tm-glass-sheen tm-panel flex flex-col overflow-hidden rounded-xl bg-surface backdrop-blur-lg backdrop-saturate-150',
          standalone ? panelSize : `tm-panel-anim ${panelSize}`,
        ].join(' ')}
        role={standalone ? 'main' : 'dialog'}
        aria-modal={standalone ? undefined : true}
        aria-label="标签页总览"
      >
        {view === 'settings' ? (
          <SettingsView onBack={() => setView('list')} onClose={() => setVisible(false)} />
        ) : (
          <TabList onOpenSettings={() => setView('settings')} />
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
