import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

/** The commit this build is made from, for the about window (and nothing at all outside git). */
function commit(): string {
  try {
    const here = fileURLToPath(new URL('.', import.meta.url));
    return execSync('git rev-parse --short HEAD', { cwd: here, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}


/**
 * The page shows one language and fetches only its texts (src/i18n.ts, a dynamic import). That import starts only once the big chunk
 * that holds i18n.ts has come and begun to run, so the page would wait a round trip for the texts: here the language is worked out the
 * same way (the address, the choice kept in settings, Telegram, the browser) in a line of the page, and its chunk is asked for at once.
 */
function preloadLanguage(): Plugin {
  return {
    name: 'pd-preload-language',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const files = Object.keys(ctx.bundle ?? {});
        const ru = files.find((file) => /(^|\/)i18n-ru-[^/]*\.js$/.test(file));
        const en = files.find((file) => /(^|\/)i18n-en-[^/]*\.js$/.test(file));
        if (!ru || !en) return html;
        const script =
          `<script>(function(){var c=new URLSearchParams(location.search).get('lang');try{if(c==null)c=localStorage.getItem('pd-lang')}catch(e){}` +
          `try{var u=window.Telegram&&Telegram.WebApp&&Telegram.WebApp.initDataUnsafe&&Telegram.WebApp.initDataUnsafe.user;if(c==null&&u)c=u.language_code}catch(e){}` +
          `if(c==null)c=navigator.language||'en';var l=document.createElement('link');l.rel='modulepreload';l.crossOrigin='';` +
          `l.href=/^(ru|uk|be|kk)/i.test(c)?'./${ru}':'./${en}';document.head.appendChild(l)})()</script>`;
        return html.replace('</head>', `${script}</head>`);
      },
    },
  };
}

export default defineConfig({
  // Relative asset paths, so the build works from any folder (GitHub Pages project sites included).
  base: './',
  plugins: [preloadLanguage()],
  define: {
    __BUILD__: JSON.stringify({ commit: commit(), date: new Date().toISOString().slice(0, 10) }),
  },
  build: {
    target: 'es2022',
    assetsInlineLimit: 0,
  },
  server: {
    // Native file events on Windows sometimes miss quick successive saves,
    // leaving stale modules in the dev server; polling catches every change.
    watch: { usePolling: true, interval: 150 },
  },
});
