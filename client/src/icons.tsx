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
