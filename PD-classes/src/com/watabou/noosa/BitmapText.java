/*
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

package com.watabou.noosa;

import java.nio.FloatBuffer;

import com.badlogic.gdx.graphics.Pixmap;
import com.badlogic.gdx.graphics.TextureData;
import com.watabou.gdx.GdxTexture;
import com.watabou.gltextures.SmartTexture;
import com.watabou.gltextures.TextureCache;
import com.watabou.glwrap.BoundBuffer;
import com.watabou.glwrap.Matrix;
import com.watabou.glwrap.Quad;

import com.watabou.utils.RectF;

public class BitmapText extends Visual {

	protected String text;
	protected Font font;

	protected float[] vertices = new float[16];
	protected FloatBuffer quads;
	protected BoundBuffer buffer;
	
	public int realLength;
	
	protected boolean dirty = true;
	
	public BitmapText() {
		this( "", null );
	}
	
	public BitmapText( Font font ) {
		this( "", font );
	}
	
	public BitmapText( String text, Font font ) {
		super( 0, 0, 0, 0 );
		
		this.text = text;
		this.font = font;
	}
	
	@Override
	public void destroy() {
		text = null;
		font = null;
		vertices = null;
		quads = null;
		super.destroy();
		if (buffer != null) {
			buffer.destroy();
		}
	}
	
	@Override
	protected void updateMatrix() {
		// "origin" field is ignored
		Matrix.setIdentity( matrix );
		Matrix.translate( matrix, x, y );
		Matrix.scale( matrix, scale.x, scale.y );
		Matrix.rotate( matrix, angle );
	}
	
	@Override
	public void draw() {
		
		super.draw();
		
		NoosaScript script = NoosaScript.get();
		
		font.texture.bind();
		
		if (dirty) {
			updateVertices();
			if (buffer == null) {
				buffer = new BoundBuffer(quads, Float.BYTES, BoundBuffer.ARRAY);
			} else {
				buffer.update(quads);
			}
		}
		
		script.camera( camera() );
		
		script.uModel.valueM4( matrix );
		script.lighting( 
			rm, gm, bm, am, 
			ra, ga, ba, aa );
		script.drawQuadSet( buffer, realLength, 0 );
		
	}
	
	protected void updateVertices() {
		
		width = 0;
		height = 0;
		
		if (text == null) {
			text = "";
		}
		
		quads = Quad.createSet( text.length() );
		realLength = 0;
		
		int length = text.length();
		for (int i=0; i < length; i++) {
			RectF rect = font.get( text.charAt( i ) );
	
			if (rect == null) {
				rect = font.get( '?' );
			}
			float w = font.width( rect );
			float h = font.height( rect );
			
			vertices[0] 	= width;
			vertices[1] 	= 0;
			
			vertices[2]		= rect.left;
			vertices[3]		= rect.top;
			
			vertices[4] 	= width + w;
			vertices[5] 	= 0;
			
			vertices[6]		= rect.right;
			vertices[7]		= rect.top;
			
			vertices[8] 	= width + w;
			vertices[9] 	= h;
			
			vertices[10]	= rect.right;
			vertices[11]	= rect.bottom;
			
			vertices[12]	= width;
			vertices[13]	= h;
			
			vertices[14]	= rect.left;
			vertices[15]	= rect.bottom;
			
			quads.put( vertices );
			realLength++;
			
			width += w + font.tracking;
			if (h > height) {
				height = h;
			}
		}
		
		if (length > 0) {
			width -= font.tracking;
		}
		
		dirty = false;
		
	}
	
	public void measure() {
		
		width = 0;
		height = 0;
		
		if (text == null) {
			text = "";
		}
		
		int length = text.length();
		for (int i=0; i < length; i++) {
			RectF rect = font.get( text.charAt( i ) );
			if (rect == null) {
				rect = font.get( '?' );
			}
	
			float w = font.width( rect );
			float h = font.height( rect );
			
			width += w + font.tracking;
			if (h > height) {
				height = h;
			}
		}
		
		if (length > 0) {
			width -= font.tracking;
		}
	}
	
	public float baseLine() {
		return font.baseLine * scale.y;
	}
	
	public Font font() {
		return font;
	}
	
	public void font( Font value ) {
		font = value;
	}
	
	public String text() {
		return text;
	}
	
	public void text( String str ) {
		text = str;
		dirty = true;
	}
	
	public static class Font extends TextureFilm {

		public static final String SPECIAL_CHAR =
			"àáâäãąèéêëęìíîïòóôöõùúûüñńçćłśźż";

		public static final String SPECIAL_CHAR_UPPER =
			"ÀÁÂÄÃĄÈÉÊËĘÌÍÎÏÒÓÔÖÕÙÚÛÜÑŃÇĆŁŚŹŻºß";
		
		public static final String LATIN_UPPER = 
			" !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ";
		
		public static final String LATIN_FULL = 
			" !\"#$%&'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~\u007F";

		private static final String LATIN_EXTENDED =
			" !¡\"#$%&'()*+,-./0123456789:;<=>?¿@ABCDEFGHIJKLMNOPQRSTUVWXYZ" +
			"[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~\u007F";

		// Cyrillic letters that cannot be reused from visually identical Latin
		// glyphs.  The remaining letters are mapped in get(char).
		public static final String CYRILLIC_UPPER = "БГДЖЗИЙЛПУФЦЧШЩЪЫЬЭЮЯ";
		public static final String CYRILLIC_LOWER = "бвгджзийлмнптуфцчшщъыьэюя";
		public static final String ALL_CHARS = LATIN_EXTENDED + SPECIAL_CHAR +
			SPECIAL_CHAR_UPPER + CYRILLIC_UPPER + CYRILLIC_LOWER;
		
		public SmartTexture texture;
		
		public float tracking = 0;
		public float baseLine;
		
		public boolean autoUppercase = false;
		
		public float lineHeight;
		
		protected Font( SmartTexture tx ) {
			super( tx );
			
			texture = tx;
		}
		
		public Font( SmartTexture tx, int width, String chars ) {
			this( tx, width, tx.height, chars );
		}
		
		public Font( SmartTexture tx, int width, int height, String chars ) {
			super( tx );
			
			texture = tx;
			
			autoUppercase = chars.equals( LATIN_UPPER );
			
			int length = chars.length();
			
			float uw = (float)width / tx.width;
			float vh = (float)height / tx.height;
			
			float left = 0;
			float top = 0;
			float bottom = vh;
			
			for (int i=0; i < length; i++) {
				RectF rect = new RectF( left, top, left += uw, bottom );
				add( chars.charAt( i ), rect );
				if (left >= 1) {
					left = 0;
					top = bottom;
					bottom += vh;
				}
			}
			
			lineHeight = baseLine = height;
		}

		private Font( SmartTexture tx, int cellWidth, int cellHeight,
				String chars, String widthData ) {
			super( tx );
			texture = tx;

			String[] widths = widthData.split( "," );
			float left = 0;
			float top = 0;
			float cellU = (float)cellWidth / tx.width;
			float cellV = (float)cellHeight / tx.height;
			for (int i = 0; i < chars.length(); i++) {
				int glyphWidth = i < widths.length ? Integer.parseInt( widths[i] ) : cellWidth;
				add( chars.charAt( i ), new RectF(
					left, top, left + (float)glyphWidth / tx.width, top + cellV ) );
				left += cellU;
				if (left >= 0.9999f) {
					left = 0;
					top += cellV;
				}
			}
			lineHeight = baseLine = cellHeight;
		}

		public static Font grid( GdxTexture bmp, int cellWidth, int cellHeight,
				String chars, String widthData ) {
			return new Font( TextureCache.get( bmp ), cellWidth, cellHeight,
				chars, widthData );
		}
		
		protected void splitBy( GdxTexture bitmap, int height, int color, String chars ) {

			autoUppercase = chars.equals( LATIN_UPPER );
			int length = chars.length();
			int width = bitmap.getWidth();
			int bitmapHeight = bitmap.getHeight();

			TextureData td = bitmap.getTextureData();
			if (!td.isPrepared()) {
				td.prepare();
			}
			final Pixmap pixmap = td.consumePixmap();

			int charsProcessed = 0;
			int lineTop = 0;
			while (lineTop < bitmapHeight && charsProcessed < length) {
				while (lineTop < bitmapHeight && isRowEmpty( pixmap, lineTop, color )) {
					lineTop++;
				}
				if (lineTop >= bitmapHeight) {
					break;
				}

				int lineBottom = lineTop;
				while (lineBottom < bitmapHeight && !isRowEmpty( pixmap, lineBottom, color )) {
					lineBottom++;
				}

				int column = 0;
				while (column < width && charsProcessed < length) {
					int empty = findEmptyColumn( pixmap, column + 1, lineTop, lineBottom, color );
					int next = findFilledColumn( pixmap, empty, lineTop, lineBottom, color );
					boolean endOfRow = next >= width;
					int charBorder = endOfRow ? empty - 1 : next - 1;

					char ch = chars.charAt( charsProcessed++ );
					int glyphRight = charBorder;
					if (ch != ' ') {
						while (glyphRight > column + 1 &&
							isColumnEmpty( pixmap, glyphRight, lineTop, lineBottom, color )) {
							glyphRight--;
						}
						glyphRight++;
					}

					add( ch, new RectF(
						(float)column / width,
						(float)lineTop / bitmapHeight,
						(float)glyphRight / width,
						(float)lineBottom / bitmapHeight ) );

					if (endOfRow) {
						break;
					}
					column = charBorder;
				}
				lineTop = lineBottom + 1;
			}
			pixmap.dispose();
			
			lineHeight = baseLine = height( frames.get( chars.charAt( 0 ) ) );
		}

		private boolean isRowEmpty( Pixmap pixmap, int y, int color ) {
			for (int x = 0; x < pixmap.getWidth(); x++) {
				if (colorNotMatch( pixmap, x, y, color )) {
					return false;
				}
			}
			return true;
		}

		private boolean isColumnEmpty( Pixmap pixmap, int x, int top, int bottom, int color ) {
			for (int y = top; y < bottom; y++) {
				if (colorNotMatch( pixmap, x, y, color )) {
					return false;
				}
			}
			return true;
		}

		private int findEmptyColumn( Pixmap pixmap, int start, int top, int bottom, int color ) {
			int x = start;
			while (x < pixmap.getWidth() && !isColumnEmpty( pixmap, x, top, bottom, color )) {
				x++;
			}
			return x;
		}

		private int findFilledColumn( Pixmap pixmap, int start, int top, int bottom, int color ) {
			int x = start;
			while (x < pixmap.getWidth() && isColumnEmpty( pixmap, x, top, bottom, color )) {
				x++;
			}
			return x;
		}

		private boolean colorNotMatch(Pixmap pixmap, int x, int y, int color) {
			int pixel = pixmap.getPixel(x, y);
			if ((pixel & 0xFF) == 0) {
				return color != 0;
			}
			return pixel != color;
		}

		public static Font colorMarked( GdxTexture bmp, int color, String chars ) {
			Font font = new Font( TextureCache.get( bmp ) );
			font.splitBy( bmp, bmp.getHeight(), color, chars );
			return font;
		}
		 
		public static Font colorMarked( GdxTexture bmp, int height, int color, String chars ) {
			Font font = new Font( TextureCache.get( bmp ) );
			font.splitBy( bmp, height, color, chars );
			return font;
		}
		
		public RectF get( char ch ) {
			// Reuse Latin glyphs for visually identical Cyrillic characters.
			switch (ch) {
			case 'А': ch = 'A'; break; case 'а': ch = 'a'; break;
			case 'В': ch = 'B'; break;
			case 'Е': ch = 'E'; break; case 'е': ch = 'e'; break;
			case 'Ё': ch = 'Ë'; break; case 'ё': ch = 'ë'; break;
			case 'К': ch = 'K'; break; case 'к': ch = 'k'; break;
			case 'М': ch = 'M'; break;
			case 'Н': ch = 'H'; break;
			case 'О': ch = 'O'; break; case 'о': ch = 'o'; break;
			case 'Р': ch = 'P'; break; case 'р': ch = 'p'; break;
			case 'С': ch = 'C'; break; case 'с': ch = 'c'; break;
			case 'Т': ch = 'T'; break;
			case 'Х': ch = 'X'; break; case 'х': ch = 'x'; break;
			}

			RectF result = super.get( autoUppercase ? Character.toUpperCase( ch ) : ch );
			if (result == null) {
				result = super.get( '?' );
			}
			if (result == null) {
				result = super.get( ' ' );
			}
			return result;
		}
	}
}
