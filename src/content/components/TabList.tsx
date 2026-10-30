import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Pin, Volume2, X, ChevronRight, Inbox, Settings2 } from 'lucide-react';
import { useStore } from '../store';
import {
  GROUP_COLOR_CLASS,
  NO_GROUP,
  hostOf,
  type TabGroupInfo,
  type TabItem,
  type WindowGroup,
} from '../../shared/types';

/* ---------- favicon ---------- */

const FAVICON_BASE = (() => {
  try {
    return chrome.runtime.getURL('/_favicon/');
  } catch {
    return '';
  }
})();

function faviconUrl(tab: TabItem): string | null {
  if (!FAVICON_BASE || !tab.url) return null;
  return `${FAVICON_BASE}?pageUrl=${encodeURIComponent(tab.url)}&size=32`;
}

/** 没有图标时用域名首字母 + 稳定色块兜底 */
const FALLBACK_COLORS = [
  'bg-rose-500/15 text-rose-500',
  'bg-amber-500/15 text-amber-600',
  'bg-emerald-500/15 text-emerald-600',
  'bg-sky-500/15 text-sky-600',
  'bg-violet-500/15 text-violet-500',
  'bg-slate-500/15 text-slate-500',
];

function colorOf(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
  return FALLBACK_COLORS[Math.abs(hash) % FALLBACK_COLORS.length];
}

function Favicon({ tab }: { tab: TabItem }) {
  const [failed, setFailed] = useState(false);
  const src = faviconUrl(tab);
  const host = hostOf(tab.url);
  const letter = (host.replace(/^[a-z]+:\/\//, '')[0] ?? '?').toUpperCase();

  if (failed || !src) {
    return (
      <div
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold ${colorOf(host)}`}
        aria-hidden
      >
        {letter}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt=""
      draggable={false}
      onError={() => setFailed(true)}
      className="h-5 w-5 shrink-0 rounded object-contain"
    />
  );
}

/* ---------- 单条标签 ---------- */

function TabRow({
  tab,
  highlighted,
  indented,
  groupColor,
  onHover,
  rowRef,
}: {
  tab: TabItem;
  highlighted: boolean;
  /** 属于某个标签组时缩进，视觉上从属于上面的组头 */
  indented: boolean;
  /** 组色，用来画左侧的从属竖线 */
  groupColor?: string;
  onHover: () => void;
  rowRef: (el: HTMLDivElement | null) => void;
}) {
  const activateTab = useStore((s) => s.activateTab);
  const closeTab = useStore((s) => s.closeTab);

  return (
    <div
      ref={rowRef}
      onMouseEnter={onHover}
      onMouseDown={(e) => {
        if (e.button !== 0) return;
        void activateTab(tab.id, tab.windowId);
      }}
      title={`${tab.title}\n${tab.url}`}
      className={[
        'group relative flex h-16 cursor-pointer select-none flex-col justify-center gap-0.5 rounded-xl bg-cardbg px-3 ring-1 transition-all duration-[250ms] ease-out',
        tab.active
          ? 'bg-accentsoft ring-brand-500/40'
          : highlighted
            ? 'ring-ink-500/30'
            : 'ring-hairline hover:ring-ink-500/20',
      ].join(' ')}
    >
      {/* 所属标签组的色条：网格布局下靠颜色标识归属，不做缩进 */}
      {groupColor && (
        <span
          className={`pointer-events-none absolute bottom-2.5 left-[3px] top-2.5 w-[2px] rounded-full opacity-70 ${groupColor}`}
        />
      )}

      <div className="flex min-w-0 items-center gap-2">
        <Favicon tab={tab} />
        <span
          className={[
            'min-w-0 flex-1 truncate text-[13px] leading-tight',
            tab.active ? 'font-medium text-ink-900' : 'text-ink-700',
          ].join(' ')}
        >
          {tab.title || hostOf(tab.url)}
        </span>
      </div>

      <div className="flex min-w-0 items-center gap-1.5 pl-[26px]">
        <span className="min-w-0 truncate text-[11px] text-ink-500">{hostOf(tab.url)}</span>
        {tab.pinned && <Pin size={10} className="shrink-0 text-ink-500" />}
        {tab.audible && <Volume2 size={10} className="shrink-0 text-emerald-600" />}
      </div>

      <button
        type="button"
        title="关闭此标签页"
        onMouseDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          void closeTab(tab.id);
        }}
        className="absolute right-1 top-1 rounded p-1 text-ink-500 opacity-0 transition hover:bg-hoverstrong hover:text-ink-900 group-hover:opacity-100"
      >
        <X size={12} />
      </button>
    </div>
  );
}

/* ---------- 行模型：把「组头」和「标签」摊平成一条序列 ---------- */

type Row =
  | { kind: 'group'; group: TabGroupInfo; count: number; total: number; collapsed: boolean }
  | { kind: 'tab'; tab: TabItem; indented: boolean; groupColor?: string };

/**
 * Chrome 的标签组一定是连续的（组不可被拆开），所以按 index 顺序扫一遍，
 * 遇到新的 groupId 就插一个组头即可。
 */
function buildRows(
  tabs: TabItem[],
  groups: TabGroupInfo[],
  /** 搜索前的组大小，用来在组头显示「命中/总数」 */
  groupTotals: Map<number, number>,
  forceOpen: boolean,
  override: Record<number, boolean>,
): Row[] {
  const infoById = new Map(groups.map((g) => [g.id, g]));

  const counts = new Map<number, number>();
  for (const t of tabs) {
    if (t.groupId !== NO_GROUP) counts.set(t.groupId, (counts.get(t.groupId) ?? 0) + 1);
  }

  const rows: Row[] = [];
  let lastGroup = NO_GROUP;
  let collapsed = false;

  for (const t of tabs) {
    if (t.groupId !== lastGroup) {
      if (t.groupId === NO_GROUP) {
        collapsed = false;
      } else {
        const info = infoById.get(t.groupId);
        if (info) {
          const isCollapsed = forceOpen ? false : (override[t.groupId] ?? info.collapsed);
          const count = counts.get(t.groupId) ?? 0;
          rows.push({
            kind: 'group',
            group: info,
            count,
            total: groupTotals.get(t.groupId) ?? count,
            collapsed: isCollapsed,
          });
          collapsed = isCollapsed;
        } else {
          collapsed = false;
        }
      }
      lastGroup = t.groupId;
    }
    if (!collapsed) {
      rows.push({
        kind: 'tab',
        tab: t,
        indented: t.groupId !== NO_GROUP,
        groupColor:
          t.groupId !== NO_GROUP && infoById.get(t.groupId)
            ? GROUP_COLOR_CLASS[infoById.get(t.groupId)!.color]
            : undefined,
      });
    }
  }

  return rows;
}

/* ---------- 窗口分组 ---------- */

function WindowSection({
  group,
  index,
  rows,
  totalCount,
  activeTitle,
  showHeader,
  collapsed,
  onToggle,
  highlightId,
  setHighlightId,
  rowRefs,
  onToggleGroup,
}: {
  group: WindowGroup;
  index: number;
  rows: Row[];
  totalCount: number;
  activeTitle?: string;
  showHeader: boolean;
  collapsed: boolean;
  onToggle: () => void;
  highlightId: number | null;
  setHighlightId: (id: number) => void;
  rowRefs: React.MutableRefObject<Map<number, HTMLDivElement>>;
  onToggleGroup: (groupId: number, current: boolean) => void;
}) {
  const open = !showHeader || !collapsed;
  const shownTabs = rows.filter((r) => r.kind === 'tab').length;
  const countLabel =
    shownTabs === totalCount ? `${totalCount} 个标签` : `${shownTabs}/${totalCount} 个标签`;

  return (
    <section className="border-t border-hairline first:border-t-0">
      {showHeader && (
        <button
          type="button"
          onClick={onToggle}
          className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left transition-colors duration-[250ms] ease-out hover:bg-hoverbg"
        >
          <ChevronRight
            size={13}
            className={`shrink-0 text-ink-500 transition-transform ${open ? 'rotate-90' : ''}`}
          />
          <span className="shrink-0 text-[12px] font-medium text-ink-700">窗口 {index + 1}</span>
          {group.focused && (
            <span className="shrink-0 rounded bg-brand-500/15 px-1.5 py-px text-[10px] font-medium text-brand-500">
              当前
            </span>
          )}
          {activeTitle && (
            <span className="min-w-0 flex-1 truncate text-[11px] text-ink-500">
              · {activeTitle}
            </span>
          )}
          <span
            className={`shrink-0 text-[11px] tabular-nums text-ink-500 ${activeTitle ? '' : 'ml-auto'}`}
          >
            {countLabel}
          </span>
        </button>
      )}

      {open && (
        <div
          className="grid gap-2 px-3 pb-2"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(232px, 1fr))' }}
        >
          {rows.map((row) =>
            row.kind === 'group' ? (
              <button
                key={`g-${row.group.id}`}
                type="button"
                onClick={() => onToggleGroup(row.group.id, row.collapsed)}
                title={`标签组：${row.group.title || '未命名'}（点击折叠/展开）`}
                className="col-span-full mt-1 flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left transition-colors duration-[250ms] ease-out hover:bg-hoverbg"
              >
                <span
                  className={`h-3 w-[3px] shrink-0 rounded-full ${GROUP_COLOR_CLASS[row.group.color] ?? 'bg-slate-400'}`}
                />
                <span
                  className={`min-w-0 flex-1 truncate text-[12px] font-medium ${
                    row.group.title ? 'text-ink-700' : 'text-ink-500'
                  }`}
                >
                  {row.group.title || '未命名组'}
                </span>
                <span className="shrink-0 text-[11px] tabular-nums text-ink-500">
                  {row.count === row.total ? row.count : `${row.count}/${row.total}`}
                </span>
                <ChevronRight
                  size={12}
                  className={`shrink-0 text-ink-500 transition-transform ${row.collapsed ? '' : 'rotate-90'}`}
                />
              </button>
            ) : (
              <TabRow
                key={row.tab.id}
                tab={row.tab}
                highlighted={highlightId === row.tab.id}
                indented={row.indented}
                groupColor={row.groupColor}
                onHover={() => setHighlightId(row.tab.id)}
                rowRef={(el) => {
                  if (el) rowRefs.current.set(row.tab.id, el);
                  else rowRefs.current.delete(row.tab.id);
                }}
              />
            ),
          )}
        </div>
      )}
    </section>
  );
}

/* ---------- 主组件 ---------- */

export function TabList({
  onClose,
  onOpenSettings,
}: {
  onClose: () => void;
  onOpenSettings: () => void;
}) {
  const groups = useStore((s) => s.groups);
  const loading = useStore((s) => s.loading);
  const query = useStore((s) => s.query);
  const setQuery = useStore((s) => s.setQuery);
  const collapsed = useStore((s) => s.collapsed);
  const groupOverride = useStore((s) => s.groupOverride);
  const toggleWindow = useStore((s) => s.toggleWindow);
  const toggleGroup = useStore((s) => s.toggleGroup);
  const activateTab = useStore((s) => s.activateTab);

  const [highlightId, setHighlightId] = useState<number | null>(null);
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const inputRef = useRef<HTMLInputElement>(null);

  const q = query.trim().toLowerCase();

  // 搜索时把匹配的窗口和组都强制展开
  const filtered = useMemo(() => {
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        tabs: g.tabs.filter(
          (t) => t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.tabs.length > 0);
  }, [groups, q]);

  const sections = useMemo(
    () =>
      filtered.map((group) => {
        // 组的总数要从过滤前的数据算，否则搜索时组头只剩命中数
        const original = groups.find((g) => g.windowId === group.windowId);
        const totals = new Map<number, number>();
        for (const t of original?.tabs ?? []) {
          if (t.groupId !== NO_GROUP) totals.set(t.groupId, (totals.get(t.groupId) ?? 0) + 1);
        }
        return {
          group,
          rows: buildRows(group.tabs, group.groups, totals, Boolean(q), groupOverride),
        };
      }),
    [filtered, groups, q, groupOverride],
  );

  // 当前屏幕上真正可见的标签，键盘上下移动只在这上面走
  const visibleTabs = useMemo(() => {
    const out: TabItem[] = [];
    for (const { group, rows } of sections) {
      if (!q && collapsed.includes(group.windowId)) continue;
      for (const r of rows) if (r.kind === 'tab') out.push(r.tab);
    }
    return out;
  }, [sections, collapsed, q]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (highlightId == null) return;
    if (!visibleTabs.some((t) => t.id === highlightId)) setHighlightId(null);
  }, [visibleTabs, highlightId]);

  useEffect(() => {
    if (highlightId == null) return;
    rowRefs.current.get(highlightId)?.scrollIntoView({ block: 'nearest' });
  }, [highlightId]);

  const move = (delta: number) => {
    if (visibleTabs.length === 0) return;
    const current = visibleTabs.findIndex((t) => t.id === highlightId);
    const next =
      current === -1
        ? delta > 0
          ? 0
          : visibleTabs.length - 1
        : Math.min(visibleTabs.length - 1, Math.max(0, current + delta));
    setHighlightId(visibleTabs[next].id);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter') {
      const target = visibleTabs.find((t) => t.id === highlightId);
      if (target) {
        e.preventDefault();
        void activateTab(target.id, target.windowId);
      }
    }
  };

  return (
    <>
      {/* 搜索 + 关闭：一行搞定，不占额外的标题栏 */}
      <div className="flex shrink-0 items-center gap-1 border-b border-hairline px-4 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg bg-fieldbg px-3 py-2 ring-1 ring-hairline transition-colors duration-[250ms] ease-out focus-within:ring-ink-500/45">
          <Search size={14} className="shrink-0 text-ink-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="搜索标签页标题或网址…"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink-900 placeholder:text-ink-500 focus:outline-none"
          />
          {query && (
            <>
              <span className="shrink-0 text-[11px] tabular-nums text-ink-500">
                {visibleTabs.length} 条
              </span>
              <button
                type="button"
                onClick={() => setQuery('')}
                className="shrink-0 rounded p-0.5 text-ink-500 hover:text-ink-900"
                title="清空"
              >
                <X size={12} />
              </button>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={onOpenSettings}
          title="设置"
          className="shrink-0 rounded-lg p-2 text-ink-500 transition hover:bg-hoverstrong hover:text-ink-900"
        >
          <Settings2 size={15} />
        </button>

        <button
          type="button"
          onClick={onClose}
          title="关闭 (Esc)"
          className="shrink-0 rounded-lg p-2 text-ink-500 transition hover:bg-hoverstrong hover:text-ink-900"
        >
          <X size={16} />
        </button>
      </div>

      {/* 列表 */}
      <div className="tm-scroll min-h-0 flex-1 overflow-y-auto px-1 pb-2">
        {loading && groups.length === 0 && (
          <div className="flex h-full items-center justify-center text-[13px] text-ink-500">
            正在读取标签页…
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-ink-500">
            <Inbox size={28} strokeWidth={1.5} />
            <p className="text-[13px]">
              {q ? `没有匹配 “${query.trim()}” 的标签页` : '当前没有打开的标签页'}
            </p>
          </div>
        )}

        {sections.map(({ group, rows }) => (
          <WindowSection
            key={group.windowId}
            group={group}
            index={Math.max(0, groups.findIndex((g) => g.windowId === group.windowId))}
            rows={rows}
            totalCount={groups.find((g) => g.windowId === group.windowId)?.tabs.length ?? group.tabs.length}
            activeTitle={
              groups
                .find((g) => g.windowId === group.windowId)
                ?.tabs.find((t) => t.active)?.title || undefined
            }
            showHeader={groups.length > 1}
            collapsed={collapsed.includes(group.windowId)}
            onToggle={() => toggleWindow(group.windowId)}
            highlightId={highlightId}
            setHighlightId={setHighlightId}
            rowRefs={rowRefs}
            onToggleGroup={toggleGroup}
          />
        ))}
      </div>
    </>
  );
}
