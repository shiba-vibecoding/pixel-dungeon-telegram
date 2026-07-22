package com.watabou.pixeldungeon.ui;

import com.watabou.noosa.BitmapTextMultiline;
import com.watabou.pixeldungeon.i18n.Localization;

/** Multiline counterpart of {@link LocalizedBitmapText}. */
public class LocalizedBitmapTextMultiline extends BitmapTextMultiline {

	public LocalizedBitmapTextMultiline( String text, Font font ) {
		super( Localization.translate( text ), font );
	}

	@Override
	public void text( String value ) {
		super.text( Localization.translate( value ) );
	}
}
