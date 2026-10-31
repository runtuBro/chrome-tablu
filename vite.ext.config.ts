import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

/**
 * 第二段构建：background 与 content script。
 *
 * MV3 的 content_scripts 不支持 ES module，manifest 里只能挂普通脚本，
 * 而 Rollup 在多入口时不允许 iife 格式。所以这里用 ENTRY 环境变量
 * 逐个入口单独构建，每个入口产出单文件 IIFE。
 */
const ENTRIES = {
  content: { input: 'src/content/index.tsx', file: 'content.js', name: 'TabMindContent' },
  background: { input: 'src/background/index.ts', file: 'background.js', name: 'TabMindBg' },
  panel: { input: 'src/panel/index.tsx', file: 'panel.js', name: 'TabMindPanel' },
} as const;

type EntryKey = keyof typeof ENTRIES;

const key = (process.env.ENTRY ?? 'content') as EntryKey;
const entry = ENTRIES[key];

if (!entry) {
  throw new Error(`未知入口 ENTRY=${process.env.ENTRY}，可选：${Object.keys(ENTRIES).join(' / ')}`);
}

export default defineConfig({
  plugins: [react()],
  publicDir: rootDir + 'public',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  build: {
    outDir: rootDir + 'dist',
    // 第一个入口负责清空 dist，第二个只追加，避免把前一步的产物删掉
    emptyOutDir: key === 'content',
    minify: false, // 保持可读，便于在 DevTools 里排查
    target: 'chrome110',
    rollupOptions: {
      input: rootDir + entry.input,
      output: {
        format: 'iife',
        name: entry.name,
        extend: true,
        inlineDynamicImports: true,
        entryFileNames: entry.file,
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
