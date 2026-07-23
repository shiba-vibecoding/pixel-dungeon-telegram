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

package com.watabou.noosa.particles;

import com.badlogic.gdx.graphics.Pixmap;
import com.badlogic.gdx.graphics.TextureData;

import com.watabou.utils.RectF;

import com.watabou.gltextures.SmartTexture;
import com.watabou.noosa.Image;
import com.watabou.noosa.particles.Emitter;
import com.watabou.utils.Random;

public class BitmaskEmitter extends Emitter {

	// DON'T USE WITH COMPLETELY TRANSPARENT IMAGES!!!
	
	private SmartTexture map;
	private Pixmap pixmap;
	private int mapW;
	private int mapH;
	private boolean disposePixmap;

	public BitmaskEmitter( Image target ) {
		super();

		this.target = target;

		map = target.texture;
		mapW = map == null ? (int)target.width : map.width;
		mapH = map == null ? (int)target.height : map.height;

		try {
			if (map == null || map.bitmap == null) {
				return;
			}

			mapW = map.bitmap.getWidth();
			mapH = map.bitmap.getHeight();

			TextureData td = map.bitmap.getTextureData();
			if (td == null) {
				return;
			}
			if (!td.isPrepared()) {
				td.prepare();
			}
			pixmap = td.consumePixmap();
			disposePixmap = pixmap != null && td.disposePixmap();
		} catch (Throwable ignored) {
			// Pixel-perfect placement is decorative. Some mobile WebViews can
			// temporarily fail to decode a texture again after a resize or a
			// WebGL context change; fall back to the target rectangle instead
			// of aborting creation of the whole scene.
			pixmap = null;
			disposePixmap = false;
		}
	}

	@Override
	protected void emit( int index ) {

		RectF frame = ((Image)target).frame();
		float ofsX = frame.left * mapW;
		float ofsY = frame.top * mapH;

		float x = 0;
		float y = 0;
		for (int attempt = 0; attempt < 64; attempt++) {
			x = Random.Float( frame.width() ) * mapW;
			y = Random.Float( frame.height() ) * mapH;
			if (pixmap == null) {
				break;
			}
			try {
				if ((pixmap.getPixel( (int)(x + ofsX), (int)(y + ofsY) ) & 0x000000FF) != 0) {
					break;
				}
			} catch (Throwable ignored) {
				// A lost WebGL context can invalidate the CPU-side image. The
				// particle can still be emitted safely inside the target bounds.
				releasePixmap();
				break;
			}
		}

		factory.emit( this, index,
			target.x + x * target.scale.x,
			target.y + y * target.scale.y );
	}

	@Override
	public void destroy() {
		super.destroy();
		releasePixmap();
	}

	private void releasePixmap() {
		if (pixmap != null && disposePixmap) {
			try {
				pixmap.dispose();
			} catch (Throwable ignored) {
			}
		}
		pixmap = null;
		disposePixmap = false;
	}
}
