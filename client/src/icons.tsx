/** Small line icons, drawn here so they take the theme's colours (stroke comes from the stylesheet). */

/** A cogwheel: Settings on the home screen, Configure next to a campaign. */
export function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle className="gear-teeth" cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="6.2" />
      <circle cx="12" cy="12" r="2.4" />
    </svg>
  );
}

/** Head and shoulders: Characters. */
export function PersonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="8.2" r="3.7" />
      <path d="M4.6 20.2c.3-4.3 3.3-6.7 7.4-6.7s7.1 2.4 7.4 6.7" />
    </svg>
  );
}

/** A key: Join. */
export function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <circle cx="8" cy="12" r="4.2" />
      <path d="M12.2 12H21M17.4 12v3.4M20.2 12v2.4" />
    </svg>
  );
}

/** A crown: Host, the Dungeon Master. */
export function CrownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden>
      <path d="M4 18.5h16M5 15.5 3.5 7l5.2 4.2L12 5l3.3 6.2L20.5 7 19 15.5z" />
    </svg>
  );
}
