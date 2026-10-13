import { t } from './i18n';
import { toast } from './screens';

/** How long «A new version is out» is on screen before the page reloads. */
const NOTICE_MS = 1600;

let reloading = false;

/**
 * The server answered 409: its rules are newer than this page's. Says so, then loads the current build, which
 * picks the run up where the server has it (checked.ts, session.ts, main.ts startRun).
 */
export function reloadForUpdate(beforeReload?: () => void): void {
  if (reloading) return;
  reloading = true;
  toast(t.newVersion, { tone: 'good' });
  window.setTimeout(() => {
    try {
      beforeReload?.();
    } finally {
      location.reload();
    }
  }, NOTICE_MS);
}
