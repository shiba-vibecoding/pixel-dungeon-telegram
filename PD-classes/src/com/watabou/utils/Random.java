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

package com.watabou.utils;

import java.util.Collection;
import java.util.HashMap;

public class Random {

	public static float Float( float min, float max ) {
		return (float)(min + Math.random() * (max - min)); 
	}
	
	public static float Float( float max ) {
		return (float)(Math.random() * max);
	}
	
	public static float Float() {
		return (float)Math.random();
	}
	
	public static int Int( int max ) {
		return max > 0 ? (int)(Math.random() * max) : 0;
	}
	
	public static int Int( int min, int max ) {
		return min + (int)(Math.random() * (max - min));
	}
	
	public static int IntRange( int min, int max ) {
		return min + (int)(Math.random() * (max - min + 1));
	}
	
	public static int NormalIntRange( int min, int max ) {
		return min + (int)((Math.random() + Math.random()) * (max - min + 1) / 2f);
	}
	
	public static int chances( float[] chances ) {
		
		if (chances == null || chances.length == 0) {
			return -1;
		}

		int length = chances.length;
		
		float sum = 0;
		for (int i=0; i < length; i++) {
			if (chances[i] > 0) {
				sum += chances[i];
			}
		}

		if (!(sum > 0)) {
			return 0;
		}

		float value = Float( sum );
		for (int i=0; i < length - 1; i++) {
			if (chances[i] > 0) {
				if (value < chances[i]) {
					return i;
				}
				value -= chances[i];
			}
		}

		for (int i=length - 1; i >= 0; i--) {
			if (chances[i] > 0) {
				return i;
			}
		}
		
		return 0;
	}
	
	@SuppressWarnings("unchecked")
	public static <K> K chances( HashMap<K,Float> chances ) {
		
		if (chances == null || chances.isEmpty()) {
			return null;
		}

		int size = chances.size();

		Object[] values = chances.keySet().toArray();
		float[] probs = new float[size];
		float sum = 0;
		for (int i=0; i < size; i++) {
			Float probability = chances.get( values[i] );
			probs[i] = probability == null ? 0 : probability;
			if (probs[i] > 0) {
				sum += probs[i];
			}
		}

		if (!(sum > 0)) {
			return (K)values[0];
		}

		float value = Float( sum );

		for (int i=0; i < size - 1; i++) {
			if (probs[i] > 0) {
				if (value < probs[i]) {
					return (K)values[i];
				}
				value -= probs[i];
			}
		}

		for (int i=size - 1; i >= 0; i--) {
			if (probs[i] > 0) {
				return (K)values[i];
			}
		}

		return (K)values[0];
	}
	
	public static int index( Collection<?> collection ) {
		return (int)(Math.random() * collection.size());
	}
	
	@SafeVarargs
	public static<T> T oneOf( T... array ) {
		return array[(int)(Math.random() * array.length)];
	}
	
	public static<T> T element( T[] array ) {
		return element( array, array.length );
	}
	
	public static<T> T element( T[] array, int max ) {
		return array[(int)(Math.random() * max)];
	}
	
	@SuppressWarnings("unchecked")
	public static<T> T element( Collection<? extends T> collection ) {
		int size = collection.size();
		return size > 0 ? 
			(T)collection.toArray()[Int( size )] : 
			null;
	}
	
	public static<T> void shuffle( T[] array ) {
		for (int i=0; i < array.length - 1; i++) {
			int j = Int( i, array.length );
			if (j != i) {
				T t = array[i];
				array[i] = array[j];
				array[j] = t;
			}
		}
	}
	
	public static<U,V> void shuffle( U[] u, V[]v ) {
		for (int i=0; i < u.length - 1; i++) {
			int j = Int( i, u.length );
			if (j != i) {
				U ut = u[i];
				u[i] = u[j];
				u[j] = ut;
				
				V vt = v[i];
				v[i] = v[j];
				v[j] = vt;
			}
		}
	}
}
