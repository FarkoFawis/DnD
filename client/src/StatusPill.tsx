import type { Status } from './useGame.ts';
import { t } from './i18n.tsx';

export function StatusPill({ status }: { status: Status }) {
  const label = { connecting: t('Connecting'), online: t('Online'), offline: t('Offline') }[status];
  return (
    <span className={`status status-${status}`} aria-live="polite">
      {label}
    </span>
  );
}
