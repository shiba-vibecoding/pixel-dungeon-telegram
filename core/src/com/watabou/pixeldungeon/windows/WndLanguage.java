/*
 * Pixel Dungeon - language selection shared by desktop, Android and GWT.
 */
package com.watabou.pixeldungeon.windows;

import com.watabou.noosa.BitmapText;
import com.watabou.noosa.ui.Component;
import com.watabou.pixeldungeon.PixelDungeon;
import com.watabou.pixeldungeon.i18n.Localization;
import com.watabou.pixeldungeon.scenes.PixelScene;
import com.watabou.pixeldungeon.ui.ScrollPane;
import com.watabou.pixeldungeon.ui.Window;

import java.util.ArrayList;
import java.util.List;

public class WndLanguage extends Window {

	private static final int WIDTH = 128;
	private static final int ITEM_HEIGHT = 16;
	private static final int GAP = 1;

	private static final String[][] LANGUAGES = {
		{ "English / EN", Localization.ENGLISH },
		{ "Русский / RU", Localization.RUSSIAN },
		{ "Español / ES", Localization.SPANISH },
		{ "Français / FR", Localization.FRENCH },
		{ "Deutsch / DE", Localization.GERMAN },
		{ "Português / PT-BR", Localization.PORTUGUESE_BRAZIL },
		{ "Polski / PL", Localization.POLISH },
		{ "Italiano / IT", Localization.ITALIAN },
		{ "Türkçe / TR", Localization.TURKISH },
		{ "Українська / UK", Localization.UKRAINIAN },
		{ "Bahasa Indonesia / ID", Localization.INDONESIAN },
		{ "日本語 / JA", Localization.JAPANESE },
		{ "한국어 / KO", Localization.KOREAN },
		{ "简体中文 / ZH-CN", Localization.CHINESE_SIMPLIFIED },
		{ "繁體中文 / ZH-TW", Localization.CHINESE_TRADITIONAL }
	};

	private final List<LanguageItem> items = new ArrayList<LanguageItem>();

	public WndLanguage() {
		BitmapText title = PixelScene.createText( "Choose language", 9 );
		title.hardlight( TITLE_COLOR );
		title.measure();
		title.x = PixelScene.align( PixelScene.uiCamera, (WIDTH - title.width()) / 2 );
		add( title );

		final Component content = new Component();
		float y = 0;
		for (String[] spec : LANGUAGES) {
			LanguageItem item = new LanguageItem( spec[0], spec[1] );
			item.setRect( 0, y, WIDTH, ITEM_HEIGHT );
			content.add( item );
			items.add( item );
			y = item.bottom() + GAP;
		}
		content.setSize( WIDTH, y - GAP );

		ScrollPane list = new ScrollPane( content ) {
			@Override
			public void onClick( float x, float y ) {
				for (LanguageItem item : items) {
					if (item.onClick( x, y )) {
						break;
					}
				}
			}
		};

		int listHeight = Math.min( (int)content.height(),
			(int)PixelScene.uiCamera.height - 48 );
		float listY = title.height() + GAP;
		// Center the window camera before ScrollPane derives its screen-space
		// clipping camera from it.
		resize( WIDTH, (int)(listY + listHeight) );
		add( list );
		// ScrollPane.layout() needs its inherited window camera, so attach it
		// before assigning the rectangle (setRect triggers layout immediately).
		list.setRect( 0, listY, WIDTH, listHeight );
	}

	private class LanguageItem extends Component {

		private final String value;
		private BitmapText label;

		private LanguageItem( String text, String value ) {
			this.value = value;
			label.text( text );
			label.measure();
			if (value.equals( PixelDungeon.language() )) {
				label.hardlight( TITLE_COLOR );
			}
		}

		@Override
		protected void createChildren() {
			label = PixelScene.createInternationalText( "", 8 );
			add( label );
		}

		@Override
		protected void layout() {
			label.x = PixelScene.align( x + 3 );
			label.y = PixelScene.align( y + (height - label.baseLine()) / 2 );
		}

		private boolean onClick( float px, float py ) {
			if (px < x || px > right() || py < y || py > bottom()) {
				return false;
			}
			if (!value.equals( PixelDungeon.language() )) {
				PixelDungeon.language( value );
			} else {
				hide();
			}
			return true;
		}
	}
}
