package com.watabou.pixeldungeon.ui;

import com.watabou.noosa.BitmapText;
import com.watabou.pixeldungeon.i18n.Localization;

/** Bitmap text that localizes both its initial and subsequently assigned text. */
public class LocalizedBitmapText extends BitmapText {

	public LocalizedBitmapText( String text, Font font ) {
		super( Localization.translate( text ), font );
	}

	@Override
	public void text( String value ) {
		super.text( Localization.translate( value ) );
	}
}
