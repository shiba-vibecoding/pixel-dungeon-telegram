/*
 * Pixel Dungeon
 * Copyright (C) 2012-2015 Oleg Dolya
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */
package com.watabou.pixeldungeon.i18n;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

import com.badlogic.gdx.Gdx;

/**
 * Small, platform-neutral localization layer.
 *
 * The original game predates libGDX i18n and keeps display strings in Java
 * constants.  The catalogue therefore maps the original English text to its
 * translation.  This lets desktop, Android and GWT share the same resources
 * without changing save-game keys or other internal identifiers.
 */
public final class Localization {

	public static final String ENGLISH = "en";
	public static final String RUSSIAN = "ru";
	public static final String SPANISH = "es";
	public static final String FRENCH = "fr";
	public static final String GERMAN = "de";
	public static final String PORTUGUESE_BRAZIL = "pt_BR";
	public static final String POLISH = "pl";
	public static final String ITALIAN = "it";
	public static final String TURKISH = "tr";
	public static final String UKRAINIAN = "uk";
	public static final String INDONESIAN = "id";
	public static final String JAPANESE = "ja";
	public static final String KOREAN = "ko";
	public static final String CHINESE_SIMPLIFIED = "zh_CN";
	public static final String CHINESE_TRADITIONAL = "zh_TW";

	private static final String[] SUPPORTED = {
		ENGLISH, RUSSIAN, SPANISH, FRENCH, GERMAN,
		PORTUGUESE_BRAZIL, POLISH, ITALIAN, TURKISH, UKRAINIAN,
		INDONESIAN, JAPANESE, KOREAN,
		CHINESE_SIMPLIFIED, CHINESE_TRADITIONAL
	};

	private static final Map<String, String> translations = new HashMap<String, String>();
	private static String language = ENGLISH;
	private static String loadedLanguage;

	private Localization() {
	}

	public static void setup( String value ) {
		language = normalize( value );
		if (!ENGLISH.equals( language )) {
			loadLanguage();
		}
	}

	public static String defaultLanguage() {
		try {
			Locale locale = Locale.getDefault();
			String code = locale.getLanguage();
			if ("pt".equalsIgnoreCase( code )) return PORTUGUESE_BRAZIL;
			if ("in".equalsIgnoreCase( code )) return INDONESIAN;
			if ("zh".equalsIgnoreCase( code )) {
				String country = locale.getCountry();
				return "TW".equalsIgnoreCase( country ) ||
					"HK".equalsIgnoreCase( country ) ||
					"MO".equalsIgnoreCase( country ) ?
					CHINESE_TRADITIONAL : CHINESE_SIMPLIFIED;
			}
			return normalize( code );
		} catch (Throwable ignored) {
			return ENGLISH;
		}
	}

	public static String normalize( String value ) {
		if (value != null) {
			String comparable = value.replace( '-', '_' );
			for (String supported : SUPPORTED) {
				if (supported.equalsIgnoreCase( comparable )) {
					return supported;
				}
			}
		}
		return ENGLISH;
	}

	public static String language() {
		return language;
	}

	/** Locale matching the selected game language, not the device language. */
	public static Locale locale() {
		int separator = language.indexOf( '_' );
		return separator < 0 ? new Locale( language ) :
			new Locale( language.substring( 0, separator ), language.substring( separator + 1 ) );
	}

	public static boolean isChinese() {
		return CHINESE_SIMPLIFIED.equals( language ) ||
			CHINESE_TRADITIONAL.equals( language );
	}

	public static boolean usesInternationalFont() {
		// Keep the original heavier pixel font for Latin and Russian text. The
		// international atlas is reserved for languages whose glyphs require it.
		return TURKISH.equals( language ) || UKRAINIAN.equals( language ) ||
			JAPANESE.equals( language ) || KOREAN.equals( language ) ||
			isChinese();
	}

	public static String translate( String text ) {
		if (text == null || text.length() == 0 || ENGLISH.equals( language )) {
			return text;
		}

		loadLanguage();

		// GLog prepends a three-character colour marker to messages.
		if (text.length() > 3 && isLogPrefix( text )) {
			return text.substring( 0, 3 ) + translate( text.substring( 3 ) );
		}

		String result = translations.get( text );
		return result == null ? text : result;
	}

	public static String translateFormat( String format ) {
		return translate( format );
	}

	private static boolean isLogPrefix( String text ) {
		return text.startsWith( "++ " ) || text.startsWith( "-- " ) ||
			text.startsWith( "** " ) || text.startsWith( "@@ " );
	}

	private static void loadLanguage() {
		if (language.equals( loadedLanguage )) {
			return;
		}
		loadedLanguage = language;
		translations.clear();
		String catalogue = "i18n/" + language + ".tsv";

		try {
			String data = Gdx.files.internal( catalogue ).readString( "UTF-8" );
			int start = 0;
			while (start < data.length()) {
				int end = data.indexOf( '\n', start );
				if (end < 0) {
					end = data.length();
				}
				String line = data.substring( start, end );
				if (line.endsWith( "\r" )) {
					line = line.substring( 0, line.length() - 1 );
				}
				int separator = line.indexOf( '\t' );
				if (separator > 0) {
					String english = unescape( line.substring( 0, separator ) );
					String translated = unescape( line.substring( separator + 1 ) );
					put( english, translated );
				}
				start = end + 1;
			}
		} catch (Throwable error) {
			Gdx.app.error( "I18N", "Unable to load " + catalogue, error );
		}
	}

	private static void put( String english, String translated ) {
		if (english == null || translated == null || english.length() == 0) {
			return;
		}
		translations.put( english, translated );

		// Android catalogues use positional placeholders, while this port's
		// original strings mostly use sequential ones.  Accept both spellings.
		String normalized = removeArgumentPositions( english );
		if (!normalized.equals( english )) {
			translations.put( normalized, translated );
		}
	}

	private static String removeArgumentPositions( String value ) {
		StringBuilder result = new StringBuilder();
		for (int i = 0; i < value.length(); i++) {
			char ch = value.charAt( i );
			result.append( ch );
			if (ch == '%' && i + 1 < value.length() && value.charAt( i + 1 ) != '%') {
				int pos = i + 1;
				while (pos < value.length() && Character.isDigit( value.charAt( pos ) )) {
					pos++;
				}
				if (pos > i + 1 && pos < value.length() && value.charAt( pos ) == '$') {
					i = pos;
				}
			}
		}
		return result.toString();
	}

	private static String unescape( String value ) {
		StringBuilder result = new StringBuilder( value.length() );
		boolean escaped = false;
		for (int i = 0; i < value.length(); i++) {
			char ch = value.charAt( i );
			if (escaped) {
				switch (ch) {
				case 'n': result.append( '\n' ); break;
				case 'r': result.append( '\r' ); break;
				case 't': result.append( '\t' ); break;
				default: result.append( ch ); break;
				}
				escaped = false;
			} else if (ch == '\\') {
				escaped = true;
			} else {
				result.append( ch );
			}
		}
		if (escaped) {
			result.append( '\\' );
		}
		return result.toString();
	}
}
