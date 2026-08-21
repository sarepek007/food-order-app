import { AUDIT_ACTION_LABELS, ORDER_STATUS_LABELS, type AuditEntry } from '@food/contracts';
import { formatDateTime, formatRelative } from '@/lib/format';

const MARKERS: Record<AuditEntry['action'], string> = {
  ORDER_CREATED: 'bg-slate-300',
  STATUS_CHANGED: 'bg-accent',
  COURIER_ASSIGNED: 'bg-violet-400',
  COURIER_CHANGED: 'bg-violet-400',
  COURIER_UNASSIGNED: 'bg-slate-400',
  ORDER_CANCELLED: 'bg-danger',
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
      return '';
  }
}

export function AuditTimeline({ entries }: { entries: AuditEntry[] }) {
  return (
    <ol className="flex flex-col gap-4">
      {entries.map((entry) => (
        <li key={entry.id} className="flex gap-3">
          <span
            aria-hidden="true"
            className={`mt-1.5 size-2 shrink-0 rounded-full ${MARKERS[entry.action]}`}
          />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {AUDIT_ACTION_LABELS[entry.action]}
              {describe(entry) && <span className="font-normal text-muted"> · {describe(entry)}</span>}
            </p>
            {entry.comment && <p className="mt-0.5 text-sm text-muted">«{entry.comment}»</p>}
            <p className="mt-0.5 text-xs text-slate-400">
              {entry.actor} · <time dateTime={entry.createdAt} title={formatDateTime(entry.createdAt)}>
                {formatRelative(entry.createdAt)}
              </time>
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
