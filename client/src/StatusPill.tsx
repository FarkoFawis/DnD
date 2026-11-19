import type { Status } from './useGame.ts';

export function StatusPill({ status }: { status: Status }) {
  const label = { connecting: 'Connecting', online: 'Online', offline: 'Offline' }[status];
  return (
    <span className={`status status-${status}`} aria-live="polite">
      {label}
    </span>
  );
}
