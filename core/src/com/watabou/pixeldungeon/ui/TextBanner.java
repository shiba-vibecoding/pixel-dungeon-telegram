/*
 * Pixel Dungeon
 * Copyright (C) 2012-2015 Oleg Dolya
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */
package com.watabou.pixeldungeon.ui;

import com.watabou.noosa.BitmapText;
import com.watabou.noosa.Game;

/** A localized bitmap-font banner with the same fade lifecycle as image banners. */
public class TextBanner extends LocalizedBitmapText {

	private enum State {
		FADE_IN, STATIC, FADE_OUT
	}

	private State state;
	private float time;
	private float fadeTime;
	private float showTime;

	public TextBanner( String text, BitmapText.Font font, float scale ) {
		super( text, font );
		this.scale.set( scale );
		measure();
		alpha( 0 );
	}

	public void show( int color, float fadeTime, float showTime ) {
		hardlight( color );
		this.fadeTime = fadeTime;
		this.showTime = showTime;
		state = State.FADE_IN;
		time = fadeTime;
	}

	public void show( int color, float fadeTime ) {
		show( color, fadeTime, Float.MAX_VALUE );
	}

	@Override
	public void update() {
		super.update();
		time -= Game.elapsed;
		if (time >= 0) {
			float progress = time / fadeTime;
			switch (state) {
			case FADE_IN:
				alpha( 1 - progress );
				break;
			case STATIC:
				break;
			case FADE_OUT:
				alpha( progress );
				break;
			}
		} else {
			switch (state) {
			case FADE_IN:
				time = showTime;
				state = State.STATIC;
				break;
			case STATIC:
				time = fadeTime;
				state = State.FADE_OUT;
				break;
			case FADE_OUT:
				killAndErase();
				break;
			}
		}
	}
}
