package com.watabou.pixeldungeon.client;

import java.io.IOException;

import com.badlogic.gdx.ApplicationListener;
import com.badlogic.gdx.Gdx;
import com.badlogic.gdx.backends.gwt.GwtApplicationConfiguration;
import com.badlogic.gdx.backends.gwt.ResilientGwtApplication;
import com.badlogic.gdx.backends.gwt.preloader.Preloader.PreloaderCallback;
import com.badlogic.gdx.utils.Base64Coder;
import com.watabou.noosa.audio.Music;
import com.watabou.pixeldungeon.Assets;
import com.watabou.pixeldungeon.PixelDungeon;
import com.watabou.utils.PDPlatformSupport;
import com.watabou.input.NoosaInputProcessor;
import com.google.gwt.user.client.Window;
import com.google.gwt.user.client.ui.RootPanel;

public class HtmlLauncher extends ResilientGwtApplication {

	private boolean lifecyclePaused;

	@Override
	public GwtApplicationConfiguration getConfig() {
		GwtApplicationConfiguration config = new GwtApplicationConfiguration();
		// Telegram's content-safe rectangle, rather than the outer browser
		// window, owns sizing.  Supplying the existing host also prevents
		// libGDX from installing a second window-based resize pipeline.
		config.rootPanel = RootPanel.get( "embed-html" );
		config.padHorizontal = 0;
		config.padVertical = 0;
		return config;
	}

	@Override
	public void onModuleLoad() {
		installBrowserBridges();
		super.onModuleLoad();
	}

	@Override
	public PreloaderCallback getPreloaderCallback () {
		return createPreloaderPanel("banner.png");
	}

	@Override
	public ApplicationListener createApplicationListener() {
		String version = "1.9.2a-gdx1.1";
		return new PixelDungeon(new HtmlPlatformSupport(version, null, new HtmlInputProcessor()));
	}

	@Override
	protected void onFrameError(Throwable error, int consecutiveErrors) {
		recordFrameError(error == null ? "Unknown frame error" : error.toString(), consecutiveErrors);
	}

	private static native void recordFrameError(String message, int consecutiveErrors) /*-{
		try {
			var value = JSON.stringify({
				time: new Date().toISOString(),
				message: String(message || "Unknown frame error").substring(0, 1000),
				consecutive: consecutiveErrors
			});
			$wnd.localStorage.setItem("pdgdx-last-frame-error", value);
		} catch (ignored) {
		}
	}-*/;

	private native void installBrowserBridges() /*-{
		var self = this;
		$wnd.TelegramPixelDungeonResize = $entry(function(width, height) {
			return self.@com.watabou.pixeldungeon.client.HtmlLauncher::resizeGame(II)(
				Math.round(Number(width) || 0), Math.round(Number(height) || 0));
		});
		$wnd.TelegramPixelDungeonPause = $entry(function() {
			return self.@com.watabou.pixeldungeon.client.HtmlLauncher::pauseGame()();
		});
		$wnd.TelegramPixelDungeonResume = $entry(function() {
			return self.@com.watabou.pixeldungeon.client.HtmlLauncher::resumeGame()();
		});
	}-*/;

	private boolean resizeGame( int width, int height ) {
		return resizeDrawingArea( width, height );
	}

	private boolean pauseGame() {
		ApplicationListener listener = getApplicationListener();
		if (listener == null) {
			return false;
		}
		if (!lifecyclePaused) {
			listener.pause();
			lifecyclePaused = true;
		}
		return true;
	}

	private boolean resumeGame() {
		ApplicationListener listener = getApplicationListener();
		if (listener == null) {
			return false;
		}
		if (lifecyclePaused) {
			listener.resume();
			lifecyclePaused = false;
		}
		return true;
	}

	static class HtmlPlatformSupport<GameActionType> extends PDPlatformSupport {
		private static final String FILE_ENCODING_PREFIX = "b64:";

		boolean isFullscreen = true;
		private final String storageScope;

		public HtmlPlatformSupport(String version, String basePath, NoosaInputProcessor<GameActionType> inputProcessor) {
			super(version, basePath, inputProcessor);
			// A late Telegram SDK must never split settings and game files
			// between two namespaces during one running session.
			storageScope = telegramStorageScope();
		}

		@Override
		public String preferencesName(String baseName) {
			return storageScope.length() == 0 ? baseName : baseName + "-" + storageScope;
		}

		private static native String telegramStorageScope() /*-{
			try {
				var bridge = $wnd.PixelDungeonStorage;
				if (bridge && typeof bridge.scope === "function") {
					var frozen = String(bridge.scope() || "");
					if (frozen) return frozen;
				}
				var tg = $wnd.Telegram && $wnd.Telegram.WebApp;
				var user = tg && tg.initDataUnsafe && tg.initDataUnsafe.user;
				var id = user && user.id != null ? String(user.id) : "";
				if (tg && tg.initData && /^[0-9]+$/.test(id)) {
					return "tg-" + id;
				}
			} catch (e) {
			}
			return "";
		}-*/;

		@Override
		public byte[] readFile(String fileName) throws IOException {
			String value = storageGet(fileStorageKey(fileName));
			if (value == null) {
				throw new IOException("File " + fileName + " doesn't exist");
			}
			if (value.startsWith(FILE_ENCODING_PREFIX)) {
				try {
					return Base64Coder.decode(value.substring(FILE_ENCODING_PREFIX.length()));
				} catch (RuntimeException error) {
					throw new IOException("Invalid encoded save file");
				}
			}
			// Backward compatibility for saves written by the old
			// GwtPreferences-based adapter.  The next write migrates to Base64.
			return value.getBytes();
		}

		@Override
		public void writeFile(String fileName, byte[] data) {
			String key = fileStorageKey(fileName);
			String value = FILE_ENCODING_PREFIX + new String(Base64Coder.encode(data));
			storageSet(key, value);
			if (!value.equals(storageGet(key))) {
				throw new IllegalStateException("Unable to verify saved file");
			}
			notifyStorageChanged();
		}

		@Override
		public boolean deleteFile(String fileName) {
			boolean had = storageRemove(fileStorageKey(fileName));
			if (had) {
				notifyStorageChanged();
			}
			return had;
		}

		private String fileStorageKey(String fileName) {
			// Match libGDX GwtPreferences' historic string-key spelling so
			// every existing local and Telegram CloudStorage save remains valid.
			return preferencesName("pd-files") + ":" + fileName + "s";
		}

		private static native String storageGet(String key) /*-{
			var value = $wnd.localStorage.getItem(key);
			return value == null ? null : String(value);
		}-*/;

		private static native void storageSet(String key, String value) /*-{
			$wnd.localStorage.setItem(key, value);
		}-*/;

		private static native boolean storageRemove(String key) /*-{
			var had = $wnd.localStorage.getItem(key) != null;
			$wnd.localStorage.removeItem(key);
			return had;
		}-*/;

		private static native void notifyStorageChanged() /*-{
			var bridge = $wnd.PixelDungeonStorage;
			if (bridge && typeof bridge.markLocalChange === "function") {
				bridge.markLocalChange();
			}
		}-*/;

		@Override
		public boolean isFullscreenEnabled() {
			return true;
		}

		@Override
		public boolean fullscreenDefault() {
			return true;
		}

		@Override
		public void fullscreen() {
			windowed(Window.getClientWidth(), Window.getClientHeight());
			isFullscreen = true;
		}

		@Override
		public void windowed(int width, int height) {
			super.windowed(width, height);
			isFullscreen = false;
		}

		@Override
		public boolean isFullscreen() {
			return isFullscreen;
		}

		@Override
		public boolean musicDefault() {
			return true;
		}

		public PDThread newThread(Runnable runnable) {
			return new HtmlThread(runnable);
		}
	}

	static class HtmlThread implements PDPlatformSupport.PDThread {
		Runnable runnable;
		boolean isAlive = false;
		public HtmlThread(Runnable runnable) {
			this.runnable = runnable;
		}

		public void start() {
			isAlive = true;
			Gdx.app.postRunnable(new Runnable() {
				public void run() {
					try {
						runnable.run();
					} finally {
						isAlive = false;
					}
				}
			});
		}

		public boolean isAlive() {
			return isAlive;
		}
	}
}
