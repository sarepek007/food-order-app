import { Button } from '@/components/Button';
import { ArrowLeftIcon, ArrowRightIcon } from '@/components/icons';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

const PAGE_SIZES = [10, 25, 50, 100];

export function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  return (
    <nav
      aria-label="Постраничная навигация"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-surface-muted px-3 py-2"
    >
      {/* Единой строкой, а не через интерполяцию по кускам: иначе текст
          разбивается на несколько узлов и становится нечитаемым для
          скринридеров и тестов. */}
      <p className="text-xs text-muted">{`Показаны ${from}–${to} из ${total}`}</p>

      <div className="flex items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-muted">
          На странице
          <select
            value={pageSize}
            onChange={(event) => onPageSizeChange(Number(event.target.value))}
            className="rounded-lg bg-surface px-2 py-1 text-sm ring-1 ring-line"
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <Button
          size="sm"
          icon={<ArrowLeftIcon />}
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          Назад
        </Button>
        <span className="tabular text-xs text-muted">
          {`${page} / ${Math.max(totalPages, 1)}`}
        </span>
        <Button size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}>
          Вперёд
          <ArrowRightIcon />
        </Button>
      </div>
    </nav>
  );
}
