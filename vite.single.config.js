// Сборка игры в ОДИН html-файл (весь JS и CSS внутри) — удобно, чтобы поделиться или открыть без сервера.
import { defineConfig } from 'vite';

function inlineEverything() {
  return {
    name: 'inline-everything',
    enforce: 'post',
    generateBundle(_, bundle) {
      const htmlName = Object.keys(bundle).find((n) => n.endsWith('.html'));
      if (!htmlName) return;
      const html = bundle[htmlName];
      let src = typeof html.source === 'string' ? html.source : new TextDecoder().decode(html.source);
      for (const [name, item] of Object.entries(bundle)) {
        if (item.type === 'chunk' && item.isEntry) {
          const code = item.code.replace(/__VITE_PRELOAD__/g, 'void 0').replace(/<\/script/gi, '<\\/script');
          const re = new RegExp(`<script[^>]*src="[^"]*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*></script>`);
          src = src.replace(re, () => `<script type="module">${code}</script>`);
          delete bundle[name];
        } else if (item.type === 'asset' && name.endsWith('.css')) {
          const css = typeof item.source === 'string' ? item.source : new TextDecoder().decode(item.source);
          const re = new RegExp(`<link[^>]*href="[^"]*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`);
          src = src.replace(re, () => `<style>${css}</style>`);
          delete bundle[name];
        }
      }
      html.source = src;
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [inlineEverything()],
  build: {
    target: 'es2020',
    outDir: 'dist-single',
    emptyOutDir: true,
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    modulePreload: false,
    chunkSizeWarningLimit: 5000,
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});
