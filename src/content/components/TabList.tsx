import { useEffect, useMemo, useRef, useState } from 'react';
import { Pin, Volume2, X, ChevronRight, Inbox, Settings2, Star } from 'lucide-react';
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
        className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md text-[10px] font-semibold ${colorOf(host)}`}
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
      className="h-[18px] w-[18px] shrink-0 rounded object-contain"
    />
  );
}

/* ---------- 单条标签 ---------- */

function TabRow({
  tab,
  highlighted,
  onHover,
  rowRef,
}: {
  tab: TabItem;
  highlighted: boolean;
  onHover: () => void;
  rowRef: (el: HTMLDivElement | null) => void;
}) {
  const activateTab = useStore((s) => s.activateTab);
  const closeTab = useStore((s) => s.closeTab);
  const bookmarks = useStore((s) => s.bookmarks);
  const toggleBookmark = useStore((s) => s.toggleBookmark);
  const bookmarked = Boolean(bookmarks[tab.url]);

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
        'group relative mx-1 flex h-9 cursor-pointer select-none items-center gap-2.5 rounded-lg pl-2.5 pr-2 transition-colors duration-[250ms] ease-out',
        tab.active
          ? 'bg-accentsoft'
          : highlighted
            ? 'bg-accentsoft'
            : 'hover:bg-hoverstrong',
      ].join(' ')}
    >
      <button
        type="button"
        title={bookmarked ? '取消收藏' : '收藏此标签页'}
        onMouseDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          void toggleBookmark(tab);
        }}
        className={[
          '-ml-1 shrink-0 rounded p-1 transition hover:bg-hoverstrong',
          bookmarked ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
        ].join(' ')}
      >
        <Star
          size={12}
          className={bookmarked ? 'fill-amber-400 text-amber-400' : 'text-ink-500'}
        />
      </button>

      <Favicon tab={tab} />

      <span
        className={[
          'min-w-0 flex-1 truncate text-[13px]',
          tab.active ? 'font-medium text-ink-900' : 'text-ink-700',
        ].join(' ')}
      >
        {tab.title || hostOf(tab.url)}
      </span>

      {tab.pinned && <Pin size={11} className="shrink-0 text-ink-500" />}
      {tab.audible && <Volume2 size={11} className="shrink-0 text-emerald-600" />}

      <span className="shrink-0 max-w-[200px] truncate text-[11px] text-ink-500">
        {hostOf(tab.url)}
      </span>

      <button
        type="button"
        title="关闭此标签页"
        onMouseDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
          void closeTab(tab.id);
        }}
        className="ml-0.5 shrink-0 rounded p-1 text-ink-500 opacity-0 transition hover:bg-hoverstrong hover:text-ink-900 group-hover:opacity-100"
      >
        <X size={12} />
      </button>
    </div>
  );
}

/* ---------- 行模型：把「组头」和「标签」摊平成一条序列 ---------- */

type Block =
  | {
      kind: 'group';
      group: TabGroupInfo;
      count: number;
      total: number;
      collapsed: boolean;
      tabs: TabItem[];
    }
  | { kind: 'tabs'; key: string; tabs: TabItem[] };

/**
 * Chrome 的标签组一定是连续的（组不可被拆开），所以按 index 顺序扫一遍即可。
 *
 * 产出的不是"组头 + 散卡"的扁平序列，而是"组块 / 散卡块"两类区块：
 * 组块自带容器，把组内卡片装进去；散卡块是连续的未分组标签。
 * 这样组的边界由容器表达，而不是靠中间插一行标题。
 */
function buildBlocks(
  tabs: TabItem[],
  groups: TabGroupInfo[],
  /** 搜索前的组大小，用来在组头显示「命中/总数」 */
  groupTotals: Map<number, number>,
  forceOpen: boolean,
  override: Record<number, boolean>,
): Block[] {
  const infoById = new Map(groups.map((g) => [g.id, g]));
  const blocks: Block[] = [];
  let loose: TabItem[] = [];
  let i = 0;

  const flushLoose = () => {
    if (loose.length) {
      blocks.push({ kind: 'tabs', key: `loose-${loose[0].id}`, tabs: loose });
      loose = [];
    }
  };

  while (i < tabs.length) {
    const t = tabs[i];

    if (t.groupId === NO_GROUP) {
      loose.push(t);
      i++;
      continue;
    }

    const gid = t.groupId;
    const info = infoById.get(gid);

    // 收集同组的连续标签
    const groupTabs: TabItem[] = [];
    while (i < tabs.length && tabs[i].groupId === gid) {
      groupTabs.push(tabs[i]);
      i++;
    }

    if (!info) {
      // 组信息缺失（理论上不会发生），降级成普通卡片
      loose.push(...groupTabs);
      continue;
    }

    flushLoose();
    blocks.push({
      kind: 'group',
      group: info,
      count: groupTabs.length,
      total: groupTotals.get(gid) ?? groupTabs.length,
      collapsed: forceOpen ? false : (override[gid] ?? info.collapsed),
      tabs: groupTabs,
    });
  }

  flushLoose();
  return blocks;
}

/* ---------- 窗口分组 ---------- */

function WindowSection({
  group,
  index,
  blocks,
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
  blocks: Block[];
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
  // 折叠的组块里那些标签不算"可见"
  const shownTabs = blocks.reduce(
    (n, b) => n + (b.kind === 'tabs' || !b.collapsed ? b.tabs.length : 0),
    0,
  );
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
        <div className="flex flex-col gap-2 px-3 pb-2">
          {blocks.map((block) => {
            const renderTab = (tab: TabItem) => (
              <TabRow
                key={tab.id}
                tab={tab}
                highlighted={highlightId === tab.id}
                onHover={() => setHighlightId(tab.id)}
                rowRef={(el) => {
                  if (el) rowRefs.current.set(tab.id, el);
                  else rowRefs.current.delete(tab.id);
                }}
              />
            );

            // 连续的未分组标签：直接铺在网格里
            if (block.kind === 'tabs') {
              return (
                <div key={block.key} className="flex flex-col">
                  {block.tabs.map(renderTab)}
                </div>
              );
            }

            // 标签组：独立容器，把组内卡片装进去，边界由容器表达
            return (
              <div
                key={`g-${block.group.id}`}
                className="rounded-xl bg-groupbg p-2 ring-1 ring-hairline"
              >
                <button
                  type="button"
                  onClick={() => onToggleGroup(block.group.id, block.collapsed)}
                  title={`标签组：${block.group.title || '未命名'}（点击折叠/展开）`}
                  className="mb-1.5 flex w-full items-center gap-2 rounded-lg py-0.5 text-left transition-colors duration-[250ms] ease-out hover:bg-hoverbg"
                >
                  <span
                    className={`h-3 w-[3px] shrink-0 rounded-full ${GROUP_COLOR_CLASS[block.group.color] ?? 'bg-slate-400'}`}
                  />
                  <span
                    className={`min-w-0 flex-1 truncate text-[12px] font-medium ${
                      block.group.title ? 'text-ink-700' : 'text-ink-500'
                    }`}
                  >
                    {block.group.title || '未命名组'}
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-ink-500">
                    {block.count === block.total ? block.count : `${block.count}/${block.total}`}
                  </span>
                  <ChevronRight
                    size={12}
                    className={`shrink-0 text-ink-500 transition-transform ${block.collapsed ? '' : 'rotate-90'}`}
                  />
                </button>

                {!block.collapsed && (
                  <div className="flex flex-col">
                    {block.tabs.map(renderTab)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ---------- 主组件 ---------- */

export function TabList({ onOpenSettings }: { onOpenSettings: () => void }) {
  const groups = useStore((s) => s.groups);
  const loading = useStore((s) => s.loading);
  const collapsed = useStore((s) => s.collapsed);
  const groupOverride = useStore((s) => s.groupOverride);
  const toggleWindow = useStore((s) => s.toggleWindow);
  const toggleGroup = useStore((s) => s.toggleGroup);
  const activateTab = useStore((s) => s.activateTab);

  const [highlightId, setHighlightId] = useState<number | null>(null);
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const rootRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(
    () =>
      groups.map((group) => {
        const totals = new Map<number, number>();
        for (const t of group.tabs) {
          if (t.groupId !== NO_GROUP) totals.set(t.groupId, (totals.get(t.groupId) ?? 0) + 1);
        }
        return {
          group,
          blocks: buildBlocks(group.tabs, group.groups, totals, false, groupOverride),
        };
      }),
    [groups, groupOverride],
  );

  // 当前屏幕上真正可见的标签，键盘上下移动只在这上面走
  const visibleTabs = useMemo(() => {
    const out: TabItem[] = [];
    for (const { group, blocks } of sections) {
      if (collapsed.includes(group.windowId)) continue;
      for (const b of blocks) {
        if (b.kind === 'tabs' || !b.collapsed) out.push(...b.tabs);
      }
    }
    return out;
  }, [sections, collapsed]);

  // 没有搜索框了，焦点放到面板根节点，↑↓ / Enter 才能收到
  useEffect(() => {
    rootRef.current?.focus();
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

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
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
    <div
      ref={rootRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="relative flex min-h-0 flex-1 flex-col outline-none"
    >
      {/* 右上角设置：无背景，只有图标；列表顶部留出 pt-10 让位 */}
      <button
        type="button"
        onClick={onOpenSettings}
        title="设置"
        className="absolute right-2 top-2 z-10 rounded-lg p-1.5 text-ink-500 transition hover:bg-hoverstrong hover:text-ink-900"
      >
        <Settings2 size={16} />
      </button>

      {/* 列表 */}
      <div className="tm-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-10">
        {loading && groups.length === 0 && (
          <div className="flex h-full items-center justify-center text-[13px] text-ink-500">
            正在读取标签页…
          </div>
        )}

        {!loading && groups.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-ink-500">
            <Inbox size={28} strokeWidth={1.5} />
            <p className="text-[13px]">当前没有打开的标签页</p>
          </div>
        )}

        {sections.map(({ group, blocks }) => (
          <WindowSection
            key={group.windowId}
            group={group}
            index={Math.max(0, groups.findIndex((g) => g.windowId === group.windowId))}
            blocks={blocks}
            totalCount={group.tabs.length}
            activeTitle={group.tabs.find((t) => t.active)?.title || undefined}
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
    </div>
  );
}
