/*
 * Telegram Mini App integration. Everything degrades gracefully in a plain
 * browser: no init data, invites become ordinary links, haptics do nothing.
 */

interface WebApp {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: { id: number; first_name?: string; username?: string } };
  platform: string;
  ready(): void;
  expand(): void;
  isVersionAtLeast?(version: string): boolean;
  disableVerticalSwipes?(): void;
  enableVerticalSwipes?(): void;
  /** Bot API 6.2: Telegram asks before the app is closed. */
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  setBottomBarColor?(color: string): void;
  openTelegramLink?(url: string): void;
  openLink?(url: string): void;
  openInvoice?(url: string, callback?: (status: 'paid' | 'cancelled' | 'failed' | 'pending') => void): void;
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
  };
  BackButton?: { show(): void; hide(): void; onClick(callback: () => void): void };
  onEvent?(event: string, callback: () => void): void;
  /** Bot API 6.9: a few kilobytes kept on the player's account. */
  CloudStorage?: CloudStorage;
  /** Bot API 7.8: a story with a picture (a public https address). */
  shareToStory?(mediaUrl: string, params?: { text?: string; widget_link?: { url: string; name?: string } }): void;
  /** Bot API 8.0: sends a message the bot prepared (savePreparedInlineMessage) to a chat the player picks. */
  shareMessage?(id: string, callback?: (sent: boolean) => void): void;
  /** Bot API 6.9: lets the bot write to the player. */
  requestWriteAccess?(callback?: (granted: boolean) => void): void;
  /** Bot API 8.0: the game's icon on the phone's home screen. */
  addToHomeScreen?(): void;
  checkHomeScreenStatus?(callback?: (status: 'unsupported' | 'unknown' | 'added' | 'missed') => void): void;
  /** Bot API 8.0: the Mini App over the whole screen. */
  isFullscreen?: boolean;
  requestFullscreen?(): void;
  exitFullscreen?(): void;
}

export interface CloudStorage {
  setItem(key: string, value: string, callback?: (error: string | null, stored?: boolean) => void): void;
  getItems(keys: string[], callback: (error: string | null, values?: Record<string, string>) => void): void;
  removeItems?(keys: string[], callback?: (error: string | null, removed?: boolean) => void): void;
}

const webApp = (globalThis as { Telegram?: { WebApp?: WebApp } }).Telegram?.WebApp;

/** The account's cloud storage, inside a Telegram new enough to have it. */
export const cloudStorage = (): CloudStorage | null =>
  webApp && webApp.initData && webApp.isVersionAtLeast?.('6.9') ? (webApp.CloudStorage ?? null) : null;

/** True when running inside Telegram (the script is loaded in browsers too). */
export const inTelegram = Boolean(webApp?.initData);

/** Telegram's platform (ios, android, tdesktop, weba...), or 'browser' outside it. */
export const platform: string = inTelegram ? webApp!.platform || 'telegram' : 'browser';

/** The Mini App's t.me link, used for invitations. */
const APP_LINK: string = import.meta.env.VITE_TG_APP_LINK ?? 'https://t.me/pixel_dungeon_gamebot/pixel_dungeon';

export function initTelegram(background: string): void {
  if (!webApp || !inTelegram) return;
  webApp.ready();
  webApp.expand();
  const at = (version: string): boolean => webApp.isVersionAtLeast?.(version) ?? false;
  if (at('6.1')) {
    webApp.setHeaderColor?.(background);
    webApp.setBackgroundColor?.(background);
  }
  if (at('7.10')) webApp.setBottomBarColor?.(background);
  // Bot API 8.0: on a phone the game takes the whole screen however it was opened (BotFather's full-screen
  // setting reaches only the profile's «Open» button), unless the player turned that off in the settings.
  if (at('8.0') && /^(ios|android)/.test(webApp.platform) && wantsFullscreen()) webApp.requestFullscreen?.();
}

/*
 * During a run a swipe down must not close the Mini App, and closing it asks first (the forum study's U4: a thumb
 * sliding down the map ended runs). Outside a run both are off, so the title and the lists behave as Telegram's own do.
 */
let guarded = false;

/** Whether a run is under way: swipes disabled and the closing confirmation on while it is; both undone when it is not. */
export function guardRun(on: boolean): void {
  if (!webApp || !inTelegram || guarded === on) return;
  guarded = on;
  const at = (version: string): boolean => webApp.isVersionAtLeast?.(version) ?? false;
  if (at('7.7')) {
    if (on) webApp.disableVerticalSwipes?.();
    else webApp.enableVerticalSwipes?.();
  }
  if (at('6.2')) {
    if (on) webApp.enableClosingConfirmation?.();
    else webApp.disableClosingConfirmation?.();
  }
}

/** The player's choice about the whole screen, kept on this device: on unless turned off. */
function wantsFullscreen(): boolean {
  try {
    return localStorage.getItem('pd-fullscreen') !== 'off';
  } catch {
    return true;
  }
}

let onBack: (() => void) | null = null;

/** Shows Telegram's back button with a handler, or hides it with null. */
export function backButton(handler: (() => void) | null): void {
  const button = webApp?.BackButton;
  if (!button || !inTelegram || !(webApp!.isVersionAtLeast?.('6.1') ?? false)) return;
  if (!onBack && handler) button.onClick(() => onBack?.());
  onBack = handler;
  if (handler) button.show();
  else button.hide();
}

/** Calls back when Telegram changes the safe areas or the viewport. */
export function onLayoutChange(callback: () => void): void {
  if (!webApp?.onEvent || !inTelegram) return;
  for (const event of ['viewportChanged', 'safeAreaChanged', 'contentSafeAreaChanged', 'fullscreenChanged']) {
    webApp.onEvent(event, callback);
  }
}

/** Calls back when Telegram minimises or restores the app (Bot API 8.0 «deactivated» / «activated»); nothing elsewhere. */
export function onActiveChange(callback: (active: boolean) => void): void {
  if (!webApp?.onEvent || !inTelegram) return;
  webApp.onEvent('activated', () => callback(true));
  webApp.onEvent('deactivated', () => callback(false));
}

/** Whether the game can go over the whole screen here: Telegram 8.0+, or a browser that allows it. */
export function canFullscreen(): boolean {
  if (inTelegram) return Boolean(webApp!.requestFullscreen && webApp!.isVersionAtLeast?.('8.0'));
  return Boolean(document.fullscreenEnabled && document.documentElement.requestFullscreen);
}

export function isFullscreen(): boolean {
  return inTelegram ? Boolean(webApp!.isFullscreen) : Boolean(document.fullscreenElement);
}

/** Over the whole screen, or back. */
export function setFullscreen(on: boolean): void {
  try {
    localStorage.setItem('pd-fullscreen', on ? 'on' : 'off');
  } catch {
    // For this session only.
  }
  if (inTelegram) {
    if (on) webApp!.requestFullscreen?.();
    else webApp!.exitFullscreen?.();
    return;
  }
  if (on) void document.documentElement.requestFullscreen?.().catch(() => undefined);
  else if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
}

export function initData(): string | undefined {
  return inTelegram ? webApp!.initData : undefined;
}

export function telegramName(): string | undefined {
  const user = webApp?.initDataUnsafe.user;
  return user ? user.first_name || user.username : undefined;
}

/** A room to join from the launch: `startapp=room_<id>` in Telegram or `?room=<id>` in a browser. */
export function invitedRoom(): string | null {
  const start = webApp?.initDataUnsafe.start_param;
  if (start?.startsWith('room_')) return start.slice('room_'.length);
  return new URLSearchParams(location.search).get('room');
}

/** True when the app was opened to play the daily dungeon (a shared result's link). */
export function launchedForDaily(): boolean {
  return webApp?.initDataUnsafe.start_param === 'daily' || new URLSearchParams(location.search).has('daily');
}

/** Shares an invitation to a room; resolves to 'copied' when it went to the clipboard instead. */
export function shareInvite(room: string, text: string): Promise<'shared' | 'copied' | 'failed'> {
  return share(`room_${room}`, { room }, text);
}

/** True when the app was opened from a shared arena result: the arena's window comes up. */
export function launchedForArena(): boolean {
  return webApp?.initDataUnsafe.start_param === 'arena' || new URLSearchParams(location.search).has('arena');
}

/** Shares an arena result with a link that opens the arena. */
export function shareArena(text: string): Promise<'shared' | 'copied' | 'failed'> {
  return share('arena', { arena: '' }, text);
}

/** Shares a daily dungeon result with a link that opens today's dungeon. */
export function shareDaily(text: string): Promise<'shared' | 'copied' | 'failed'> {
  return share('daily', { daily: '' }, text);
}

async function share(
  startParam: string, query: Record<string, string>, text: string,
): Promise<'shared' | 'copied' | 'failed'> {
  if (inTelegram && webApp!.openTelegramLink) {
    const link = `${APP_LINK}?startapp=${encodeURIComponent(startParam)}&mode=fullscreen`;
    webApp!.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
    return 'shared';
  }
  const url = new URL(location.href);
  url.search = '';
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  const link = url.toString();
  try {
    if (navigator.share) {
      await navigator.share({ title: 'Pixel Dungeon', text, url: link });
      return 'shared';
    }
  } catch {
    // Dismissed or unsupported: fall back to the clipboard.
  }
  try {
    await navigator.clipboard.writeText(link);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/** Vibration on hits and finds, unless turned off in the settings (kept on this device). */
export const haptics = {
  on: ((): boolean => {
    try {
      return localStorage.getItem('pd-haptics') !== 'off';
    } catch {
      return true;
    }
  })(),
  set(on: boolean): void {
    this.on = on;
    try {
      localStorage.setItem('pd-haptics', on ? 'on' : 'off');
    } catch {
      // For this session only.
    }
  },
};

export function haptic(kind: 'hit' | 'hurt' | 'success' | 'error'): void {
  const feedback = webApp?.HapticFeedback;
  if (!feedback || !inTelegram || !haptics.on || !(webApp!.isVersionAtLeast?.('6.1') ?? false)) return;
  switch (kind) {
    case 'hit':
      feedback.impactOccurred('light');
      break;
    case 'hurt':
      feedback.impactOccurred('heavy');
      break;
    case 'success':
      feedback.notificationOccurred('success');
      break;
    case 'error':
      feedback.notificationOccurred('error');
      break;
  }
}

/**
 * Opens a Stars invoice (WebApp.openInvoice) and resolves to how it ended:
 * «paid», «cancelled», «failed» or «pending»; «failed» outside Telegram.
 */
export function openInvoice(link: string): Promise<'paid' | 'cancelled' | 'failed' | 'pending'> {
  return new Promise((resolve) => {
    if (!webApp?.openInvoice || !inTelegram || !(webApp.isVersionAtLeast?.('6.1') ?? false)) {
      resolve('failed');
      return;
    }
    webApp.openInvoice(link, (status) => resolve(status));
  });
}

/** Opens a web page outside the game: Telegram's own browser, or a new tab. */
export function openExternal(url: string): void {
  if (webApp?.openLink && inTelegram) webApp.openLink(url);
  else window.open(url, '_blank', 'noopener');
}

/** Opens a t.me link inside Telegram (a subscription's settings, a chat), or in a new tab elsewhere. */
export function openLink(url: string): void {
  if (webApp?.openTelegramLink && inTelegram) webApp.openTelegramLink(url);
  else window.open(url, '_blank', 'noopener');
}

const at = (version: string): boolean => inTelegram && (webApp?.isVersionAtLeast?.(version) ?? false);

/** The game's t.me link, opening at `start` (daily, arena) or at the title. */
export const appLink = (start?: string): string => `${APP_LINK}?${start ? `startapp=${encodeURIComponent(start)}&` : ''}mode=fullscreen`;

/** Whether this Telegram can post a story from the game. */
export const canShareStory = (): boolean => at('7.8') && typeof webApp?.shareToStory === 'function';

/** A story with the picture at `url` and a caption (a link in it opens the game). */
export function shareStory(url: string, text: string): void {
  webApp?.shareToStory?.(url, { text: text.slice(0, 200) });
}

/** Whether this Telegram can send a message the bot prepared. */
export const canShareMessage = (): boolean => at('8.0') && typeof webApp?.shareMessage === 'function';

/** Sends the bot's prepared message to a chat the player picks; resolves to whether it went. */
export function shareMessage(id: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (!canShareMessage()) {
      resolve(false);
      return;
    }
    webApp!.shareMessage!(id, (sent) => resolve(Boolean(sent)));
  });
}

/** Asks the player to let the bot write to them; resolves to whether they did (or had already). */
export function requestWriteAccess(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!at('6.9') || !webApp?.requestWriteAccess) {
      resolve(false);
      return;
    }
    webApp.requestWriteAccess((granted) => resolve(Boolean(granted)));
  });
}

/** Whether the game could still be put on the home screen («missed»: not there, and the phone can). */
export function homeScreenStatus(): Promise<'unsupported' | 'unknown' | 'added' | 'missed'> {
  return new Promise((resolve) => {
    if (!at('8.0') || !webApp?.checkHomeScreenStatus) {
      resolve('unsupported');
      return;
    }
    webApp.checkHomeScreenStatus((status) => resolve(status));
  });
}

export function addToHomeScreen(): void {
  if (at('8.0')) webApp?.addToHomeScreen?.();
}
