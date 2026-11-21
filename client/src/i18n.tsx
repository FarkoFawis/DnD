import { Fragment, createElement, type ReactNode } from 'react';
import { t } from '@dnd/shared';

export { getLanguage, listing, msg, plural, t, tx } from '@dnd/shared';

/**
 * `t()` for a sentence with something drawn inside it (a bold name, an icon):
 *
 *   tj('Joining {campaign}.', { campaign: <strong>{name}</strong> })
 *
 * The sentence is translated as a whole, so the other language can put the
 * name wherever its grammar wants it.
 */
export function tj(text: string, parts: Record<string, ReactNode>): ReactNode {
  const pieces = t(text).split(/\{(\w+)\}/);
  // Odd places are the names between the braces.
  return createElement(Fragment, null, ...pieces.map((piece, i) => (i % 2 === 0 ? piece : piece in parts ? parts[piece] : `{${piece}}`)));
}
