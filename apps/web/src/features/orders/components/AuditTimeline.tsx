import { AUDIT_ACTION_LABELS, ORDER_STATUS_LABELS, type AuditEntry } from '@food/contracts';
import type { ComponentType, SVGProps } from 'react';
import { ArrowRightIcon, CancelIcon, MinusIcon, PlusIcon, SwapIcon } from '@/components/icons';
import { formatDateTime, formatRelative } from '@/lib/format';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

/** Иконка и тон маркера по типу события: журнал читается взглядом, а не построчно. */
const MARKERS: Record<AuditEntry['action'], { icon: IconComponent; tone: string }> = {
  ORDER_CREATED: { icon: PlusIcon, tone: 'bg-slate-100 text-muted ring-slate-200' },
  STATUS_CHANGED: { icon: ArrowRightIcon, tone: 'bg-accent-soft text-accent ring-blue-200' },
  COURIER_ASSIGNED: { icon: PlusIcon, tone: 'bg-violet-50 text-violet-700 ring-violet-200' },
  COURIER_CHANGED: { icon: SwapIcon, tone: 'bg-violet-50 text-violet-700 ring-violet-200' },
  COURIER_UNASSIGNED: { icon: MinusIcon, tone: 'bg-slate-100 text-muted ring-slate-200' },
  ORDER_CANCELLED: { icon: CancelIcon, tone: 'bg-danger-soft text-danger ring-red-200' },
};

function describe(entry: AuditEntry): string {
  switch (entry.action) {
    case 'STATUS_CHANGED':
      return `${ORDER_STATUS_LABELS[entry.oldStatus ?? 'new']} → ${ORDER_STATUS_LABELS[entry.newStatus ?? 'new']}`;
    case 'COURIER_ASSIGNED':
      return entry.newCourier?.name ?? '—';
    case 'COURIER_CHANGED':
      return `${entry.oldCourier?.name ?? '—'} → ${entry.newCourier?.name ?? '—'}`;
    case 'COURIER_UNASSIGNED':
      return entry.oldCourier?.name ?? '—';
    case 'ORDER_CANCELLED':
      return `${ORDER_STATUS_LABELS[entry.oldStatus ?? 'new']} → ${ORDER_STATUS_LABELS.cancelled}`;
    case 'ORDER_CREATED':
      // Курьер может быть назначен прямо при создании — иначе эта запись
      // теряется: отдельного события COURIER_ASSIGNED в таком случае нет.
      return entry.newCourier ? `курьер ${entry.newCourier.name}` : '';
  }
}

export function AuditTimeline({ entries }: { entries: AuditEntry[] }) {
  return (
    <ol className="flex flex-col">
      {entries.map((entry, index) => {
        const marker = MARKERS[entry.action];
        const MarkerIcon = marker.icon;
        const isLast = index === entries.length - 1;

        return (
          <li key={entry.id} className="relative flex gap-3 pb-5 last:pb-0">
            {/* Вертикаль связывает события в одну ленту. */}
            {!isLast && (
              <span aria-hidden="true" className="absolute top-7 bottom-0 left-[13px] w-px bg-line" />
            )}

            <span
              aria-hidden="true"
              className={`relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full ring-1 ring-inset ${marker.tone}`}
            >
              <MarkerIcon className="size-3.5" />
            </span>

            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-sm font-medium text-ink">
                {AUDIT_ACTION_LABELS[entry.action]}
                {describe(entry) && (
                  <span className="font-normal text-muted">{` · ${describe(entry)}`}</span>
                )}
              </p>
              {entry.comment && (
                <p className="mt-1 rounded-md bg-surface-muted px-2 py-1 text-sm text-ink-soft">
                  {`«${entry.comment}»`}
                </p>
              )}
              <p className="mt-1 text-xs text-faint">
                {entry.actor}
                {' · '}
                <time dateTime={entry.createdAt} title={formatDateTime(entry.createdAt)}>
                  {formatRelative(entry.createdAt)}
                </time>
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
