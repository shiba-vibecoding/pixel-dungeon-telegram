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
package com.watabou.pixeldungeon.items.weapon.melee;

import com.watabou.pixeldungeon.Dungeon;
import com.watabou.pixeldungeon.i18n.Localization;
import com.watabou.pixeldungeon.items.Item;
import com.watabou.pixeldungeon.items.weapon.Weapon;
import com.watabou.pixeldungeon.utils.Utils;
import com.watabou.utils.Random;

public class MeleeWeapon extends Weapon {
	
	private int tier;

	private static final String TXT_OVERVIEW =
		"This %1$s is %2$s tier-%3$d melee weapon.";
	private static final String TXT_AVERAGE = "Its average damage is %d points per hit.";
	private static final String TXT_TYPICAL =
		"Its typical average damage is %1$d points per hit and usually it requires %2$d points of strength.";
	private static final String TXT_TOO_HEAVY = "Probably this weapon is too heavy for you.";
	private static final String TXT_TRAIT = "This is a rather %s weapon.";
	private static final String TXT_BALANCED_SPEED = "It was balanced to make it faster.";
	private static final String TXT_BALANCED_ACCURACY = "It was balanced to make it more accurate.";
	private static final String TXT_ENCHANTED = "It is enchanted.";
	private static final String TXT_LOW_STRENGTH =
		"Because of your inadequate strength the accuracy and speed of your attack with this %s is decreased.";
	private static final String TXT_EXCESS_STRENGTH =
		"Because of your excess strength the damage of your attack with this %s is increased.";
	private static final String TXT_HOLD = "You hold the %1$s at the ready%2$s.";
	private static final String TXT_CURSED_HOLD =
		", and because it is cursed, you are powerless to let go";
	private static final String TXT_CURSED_INFO =
		"You can feel a malevolent magic lurking within %s.";
	
	public MeleeWeapon( int tier, float acu, float dly ) {
		super();
		
		this.tier = tier;
		
		ACU = acu;
		DLY = dly;
		
		STR = typicalSTR();
	}
	
	protected int min0() {
		return tier;
	}
	
	protected int max0() {
		return (int)((tier * tier - tier + 10) / ACU * DLY);
	}
	
	@Override
	public int min() {
		return isBroken() ? min0() : min0() + level(); 
	}
	
	@Override
	public int max() {
		return isBroken() ? max0() : max0() + level() * tier;
	}
	
	@Override
	final public Item upgrade() {
		return upgrade( false );
	}
	
	public Item upgrade( boolean enchant ) {
		STR--;		
		return super.upgrade( enchant );
	}
	
	public Item safeUpgrade() {
		return upgrade( enchantment != null );
	}
	
	@Override
	public Item degrade() {		
		STR++;
		return super.degrade();
	}
	
	public int typicalSTR() {
		return 8 + tier * 2;
	}
	
	@Override
	public String info() {
		
		final String p = "\n\n";
		
		StringBuilder info = new StringBuilder( Utils.format( desc() ) );
		
		int lvl = visiblyUpgraded();
		String rawQuality = lvl != 0 ?
			(lvl > 0 ? 
				(isBroken() ? "broken" : "upgraded") : 
				"degraded") : 
			"";
		String quality;
		if (Localization.ENGLISH.equals( Localization.language() )) {
			quality = Utils.indefinite( rawQuality );
		} else if ("upgraded".equals( rawQuality )) {
			quality = Utils.format( "a upgraded" );
		} else if ("degraded".equals( rawQuality )) {
			quality = Utils.format( "an degraded" );
		} else if ("broken".equals( rawQuality )) {
			quality = Utils.format( "a broken" );
		} else {
			quality = Utils.format( "a" );
		}
		info.append( p ).append( Utils.format( TXT_OVERVIEW, name, quality, tier ) );
		
		if (levelKnown) {
			int min = min();
			int max = max();
			info.append( " " ).append(
				Utils.format( TXT_AVERAGE, min + (max - min) / 2 ) );
		} else {
			int min = min0();
			int max = max0();
			info.append( " " ).append( Utils.format(
				TXT_TYPICAL, min + (max - min) / 2, typicalSTR() ) );
			if (typicalSTR() > Dungeon.hero.STR()) {
				info.append( " " ).append( Utils.format( TXT_TOO_HEAVY ) );
			}
		}
		
		String trait = null;
		if (DLY != 1f) {
			trait = Utils.format( DLY < 1f ? "fast" : "slow" );
			if (ACU != 1f) {
				trait += " " + Utils.format( (ACU > 1f) == (DLY < 1f) ? "and" : "but" ) +
					" " + Utils.format( ACU > 1f ? "accurate" : "inaccurate" );
			}
		} else if (ACU != 1f) {
			trait = Utils.format( ACU > 1f ? "accurate" : "inaccurate" );
		}
		if (trait != null) {
			info.append( " " ).append( Utils.format( TXT_TRAIT, trait ) );
		}
		switch (imbue) {
		case SPEED:
			info.append( " " ).append( Utils.format( TXT_BALANCED_SPEED ) );
			break;
		case ACCURACY:
			info.append( " " ).append( Utils.format( TXT_BALANCED_ACCURACY ) );
			break;
		case NONE:
		}
		
		if (enchantment != null) {
			info.append( " " ).append( Utils.format( TXT_ENCHANTED ) );
		}
		
		if (levelKnown && Dungeon.hero.belongings.backpack.items.contains( this )) {
			if (STR > Dungeon.hero.STR()) {
				info.append( p ).append( Utils.format( TXT_LOW_STRENGTH, name ) );
			}
			if (STR < Dungeon.hero.STR()) {
				info.append( p ).append( Utils.format( TXT_EXCESS_STRENGTH, name ) );
			}
		}
		
		if (isEquipped( Dungeon.hero )) {
			info.append( p ).append( Utils.format( TXT_HOLD, name,
				cursed ? Utils.format( TXT_CURSED_HOLD ) : "" ) );
		} else {
			if (cursedKnown && cursed) {
				info.append( p ).append( Utils.format( TXT_CURSED_INFO, name ) );
			}
		}
		
		return info.toString();
	}
	
	@Override
	public int price() {
		int price = 20 * (1 << (tier - 1));
		if (enchantment != null) {
			price *= 1.5;
		}
		return considerState( price );
	}
	
	@Override
	public Item random() {
		super.random();
		
		if (Random.Int( 10 + level() ) == 0) {
			enchant();
		}
		
		return this;
	}
}
