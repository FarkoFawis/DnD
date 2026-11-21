import { abilityModifier, proficiencyBonus, type Ability } from '../rules.ts';
import type { CharacterData } from '../protocol.ts';
import type { Content } from './index.ts';
import { t, tx } from '../i18n.ts';

export interface WeaponAttack {
  itemId: string;
  name: string;
  /** e.g. +5 */
  toHit: number;
  /** e.g. "1d8+3 Slashing" */
  damage: string;
  /** Versatile two-handed damage, range, mastery... */
  notes: string;
  ref: string;
  /** The parts of `damage`, for the dice roller: "1d8", the ability modifier, "Slashing". */
  dice: string;
  /** Damage dice when a Versatile weapon is held in two hands, e.g. "1d10". */
  versatileDice?: string;
  modifier: number;
  damageType: string;
  /** Which ability the attack uses and whether the proficiency bonus is in `toHit`. */
  ability: Ability;
  proficient: boolean;
}

/**
 * Attack rows for the weapons a character carries (2024 rules): melee uses
 * Strength, ranged Dexterity, Finesse the better of the two; proficiency from
 * the class's weapon training (assumed when the class is unknown/homebrew).
 */
export function weaponAttacks(c: CharacterData, content: Content): WeaponAttack[] {
  const cls = content.classes.find((x) => x.name.toLowerCase() === c.className.trim().toLowerCase());
  const training = (cls?.proficiencies ?? []).join(' | ').toLowerCase();
  const pb = proficiencyBonus(c.level);
  const mod = (a: Ability) => abilityModifier(c.abilities[a]);
  const out: WeaponAttack[] = [];
  for (const item of c.inventory) {
    const def = item.ref ? content.item(item.ref) : content.findByName('items', item.name);
    const w = def?.weapon;
    if (!def || !w) continue;
    const ability: Ability = w.finesse ? (mod('dex') > mod('str') ? 'dex' : 'str') : w.ranged ? 'dex' : 'str';
    const simple = def.category.toLowerCase().startsWith('simple');
    const proficient =
      !cls ||
      training.includes(simple ? 'simple weapons' : 'martial weapons') ||
      training.includes(def.name.toLowerCase()) ||
      training.includes(`${def.name.toLowerCase()}s`);
    const m = mod(ability);
    const bonus = m === 0 ? '' : m > 0 ? `+${m}` : `${m}`;
    out.push({
      itemId: item.id,
      name: def.name,
      toHit: m + (proficient ? pb : 0),
      damage: `${w.damage}${bonus} ${tx(w.damageType)}`.trim(),
      notes: [
        w.versatile && t('two-handed {dice}', { dice: `${w.versatile}${bonus}` }),
        w.range && t('range {range}', { range: w.range }),
        w.mastery && t('mastery: {name}', { name: tx(w.mastery) }),
        !proficient && t('not proficient'),
      ]
        .filter(Boolean)
        .join(' · '),
      ref: def.id,
      dice: w.damage,
      ...(w.versatile ? { versatileDice: w.versatile } : {}),
      modifier: m,
      damageType: w.damageType,
      ability,
      proficient,
    });
  }
  return out;
}
