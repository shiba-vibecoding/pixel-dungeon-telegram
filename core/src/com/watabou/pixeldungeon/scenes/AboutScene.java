/*
 * Pixel Dungeon
 * Copyright (C) 2012-2015 Oleg Dolya
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>
 */
package com.watabou.pixeldungeon.scenes;

import com.badlogic.gdx.Gdx;
import com.watabou.input.NoosaInputProcessor;
import com.watabou.noosa.*;
import com.watabou.pixeldungeon.PixelDungeon;
import com.watabou.pixeldungeon.effects.Flare;
import com.watabou.pixeldungeon.ui.Archs;
import com.watabou.pixeldungeon.ui.ExitButton;
import com.watabou.pixeldungeon.ui.Icons;
import com.watabou.pixeldungeon.ui.Window;

public class AboutScene extends PixelScene {

	private static final String TXT =
		"Code & graphics: Watabou\n" +
		"Music: Cube_Code\n\n" + 
		"This game is inspired by Brian Walker's Brogue. " +
		"Try it on Windows, Mac OS or Linux - it's awesome! ;)\n\n" +
		"Please visit official website for additional info:";

	private static final String TXT_PORTS = "LibGDX port: Arcnor / Web port: nojus297";
	private static final String TXT_TELEGRAM_PORT = "Telegram port: @barboskich";

	private static final String LNK = "pixeldungeon.watabou.ru";
	private static final String AUTHOR_LNK = "https://t.me/barboskich";
	
	@Override
	public void create() {
		super.create();
		
		final int contentWidth = Math.min( Camera.main.width - 12, PixelDungeon.landscape() ? 180 : 120 );

		BitmapTextMultiline text = createMultiline( TXT, 7 );
		text.maxWidth = contentWidth;
		text.measure();
		add( text );

		BitmapTextMultiline ports = createMultiline( TXT_PORTS, 7 );
		ports.maxWidth = contentWidth;
		ports.measure();
		add( ports );

		BitmapTextMultiline author = createMultiline( TXT_TELEGRAM_PORT, 8 );
		author.maxWidth = contentWidth;
		author.measure();
		author.hardlight( Window.TITLE_COLOR );
		add( author );

		BitmapTextMultiline link = createMultiline( LNK, 7 );
		link.maxWidth = contentWidth;
		link.measure();
		link.hardlight( Window.TITLE_COLOR );
		add( link );

		Image wata = Icons.WATA.get();
		float groupHeight = wata.height + 5 + text.height() + ports.height() +
			author.height() + link.height() + 7;
		float top = Math.max( 4, (Camera.main.height - groupHeight) / 2 );

		wata.x = align( (Camera.main.width - wata.width) / 2 );
		wata.y = align( top );
		add( wata );

		float y = wata.y + wata.height + 5;
		text.x = align( (Camera.main.width - text.width()) / 2 );
		text.y = align( y );
		y = text.y + text.height() + 2;

		ports.x = align( (Camera.main.width - ports.width()) / 2 );
		ports.y = align( y );
		y = ports.y + ports.height() + 2;

		author.x = align( (Camera.main.width - author.width()) / 2 );
		author.y = align( y );
		y = author.y + author.height() + 2;

		link.x = align( (Camera.main.width - link.width()) / 2 );
		link.y = align( y );

		TouchArea hotArea = new TouchArea( link ) {
			@Override
			protected void onClick( NoosaInputProcessor.Touch touch ) {
				Gdx.net.openURI("https://" + LNK);
			}
		};
		add( hotArea );

		TouchArea authorHotArea = new TouchArea( author ) {
			@Override
			protected void onClick( NoosaInputProcessor.Touch touch ) {
				Gdx.net.openURI( AUTHOR_LNK );
			}
		};
		add( authorHotArea );

		new Flare( 7, 64 ).color( 0x112233, true ).show( wata, 0 ).angularSpeed = +20;
		
		Archs archs = new Archs();
		archs.setSize( Camera.main.width, Camera.main.height );
		addToBack( archs );
		
		ExitButton btnExit = new ExitButton();
		btnExit.setPos( Camera.main.width - btnExit.width(), 0 );
		add( btnExit );
		
		fadeIn();
	}

	@Override
	protected void onBackPressed() {
		PixelDungeon.switchNoFade( TitleScene.class );
	}
}
