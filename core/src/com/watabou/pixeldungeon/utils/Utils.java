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
package com.watabou.pixeldungeon.utils;

import com.watabou.pixeldungeon.i18n.Localization;

public class Utils {

	public static String capitalize( String str ) {
		if (str == null || str.length() == 0) {
			return str;
		}
		return Character.toUpperCase( str.charAt( 0 ) ) + str.substring( 1 );
	}
	
	public static String format( String format, Object...args ) {
		format = Localization.translateFormat( format );
		StringBuilder builder = new StringBuilder();
		int nextArg = 0;
		for (int i = 0; i < format.length(); i++) {
			if (format.charAt(i) == '%') {
				if (++i >= format.length()) {
					throw new RuntimeException( "Invalid format" );
				}
				if (format.charAt( i ) == '%') {
					builder.append( '%' );
					continue;
				}

				int argument = -1;
				int digitsStart = i;
				while (i < format.length() && Character.isDigit( format.charAt( i ) )) {
					i++;
				}
				if (i > digitsStart && i < format.length() && format.charAt( i ) == '$') {
					argument = Integer.parseInt( format.substring( digitsStart, i ) ) - 1;
					i++;
				} else {
					i = digitsStart;
				}

				boolean showPlus = i < format.length() && format.charAt( i ) == '+';
				if (showPlus) {
					i++;
				}
				if (i >= format.length() || "dsf".indexOf( format.charAt( i ) ) < 0) {
					throw new RuntimeException( "Unknown format" );
				}

				if (argument < 0) {
					argument = nextArg++;
				}
				if (argument < 0 || argument >= args.length) {
					throw new RuntimeException( "Missing format argument" );
				}

				Object value = args[argument];
				if (showPlus && value instanceof Number && ((Number)value).doubleValue() >= 0) {
					builder.append( '+' );
				}
				if (value instanceof String) {
					builder.append( Localization.translate( (String)value ) );
				} else {
					builder.append( value );
				}
			} else {
				builder.append(format.charAt(i));
			}
		}
		return Localization.translate( builder.toString() );
	}
	
	public static String VOWELS	= "aoeiu";
	
	public static String indefinite( String noun ) {
		// The English a/an rule cannot be applied safely to translated nouns;
		// localized item names already carry the grammar their language needs.
		if (!Localization.ENGLISH.equals( Localization.language() )) {
			return noun;
		}
		if (noun.length() == 0) {
			return "a";
		} else {
			return (VOWELS.indexOf( Character.toLowerCase( noun.charAt( 0 ) ) ) != -1 ? "an " : "a ") + noun;
		}
	}
}
