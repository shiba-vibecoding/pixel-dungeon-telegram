/*
 * Copyright 2011 See libGDX AUTHORS file.
 *
 * Licensed under the Apache License, Version 2.0.
 */
package com.badlogic.gdx.backends.gwt;

import com.google.gwt.animation.client.AnimationScheduler;
import com.google.gwt.animation.client.AnimationScheduler.AnimationCallback;
import com.google.gwt.user.client.Timer;

/**
 * Keeps the web render loop alive after a transient game-frame exception.
 *
 * libGDX 1.11 schedules the next requestAnimationFrame only after mainLoop()
 * returns. One uncaught exception therefore leaves a perfectly audible game
 * with a permanently frozen canvas. A mobile WebView must be able to recover
 * from a bad display string, interrupted gesture, or one-off GL timing issue.
 */
public abstract class ResilientGwtApplication extends GwtApplication {

	private int consecutiveFrameErrors;

	/**
	 * Resizes the drawing buffer through the backend that owns it.
	 *
	 * Telegram's safe area is smaller than the browser window, so the wrapper
	 * cannot rely on libGDX's window ResizeHandler.  Changing canvas.width from
	 * unrelated JavaScript resets the WebGL drawing buffer behind libGDX's
	 * back; exposing this small backend-owned entry point keeps the graphics
	 * size, viewport and input coordinates in one lifecycle.
	 */
	protected final boolean resizeDrawingArea( int width, int height ) {
		if (graphics == null || width <= 0 || height <= 0) {
			return false;
		}
		if (graphics.getWidth() != width || graphics.getHeight() != height) {
			graphics.setCanvasSize( width, height );
		}
		return true;
	}

	@Override
	protected void setupMainLoop() {
		scheduleFrame( new AnimationCallback() {
			@Override
			public void execute( double timestamp ) {
				try {
					mainLoop();
					consecutiveFrameErrors = 0;
				} catch (Throwable frameError) {
					/*
					 * GwtApplication copies postRunnable tasks to this helper
					 * before executing them. If one task throws, the stock loop
					 * leaves the helper populated and replays the same broken
					 * task forever while music keeps running. Drop that frame's
					 * remaining tasks so the next frame can render normally.
					 */
					runnablesHelper.clear();
					consecutiveFrameErrors++;
					if (consecutiveFrameErrors <= 3 || consecutiveFrameErrors % 60 == 0) {
						error( "GwtApplication", "Recovered frame exception: " +
							frameError.getMessage(), frameError );
						frameError.printStackTrace();
					}
					onFrameError( frameError, consecutiveFrameErrors );
				}

				if (consecutiveFrameErrors < 3) {
					scheduleFrame( this );
				} else {
					final AnimationCallback callback = this;
					new Timer() {
						@Override
						public void run() {
							scheduleFrame( callback );
						}
					}.schedule( Math.min( 1000, consecutiveFrameErrors * 100 ) );
				}
			}
		} );
	}

	private void scheduleFrame( AnimationCallback callback ) {
		AnimationScheduler.get().requestAnimationFrame( callback, graphics.canvas );
	}

	/** Hook for the game to persist a bounded diagnostic for the next launch. */
	protected void onFrameError( Throwable error, int consecutiveErrors ) {
	}
}
