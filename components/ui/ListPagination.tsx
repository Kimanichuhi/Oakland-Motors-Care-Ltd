import { ChevronLeft, ChevronRight } from 'lucide-react';

export const PAGE_SIZE = 25;

/** Renders nothing once `total` is at or under PAGE_SIZE — a page's worth of
 * rows never needs Prev/Next. `page` is 0-indexed. */
export default function ListPagination({ page, total, onPageChange }: { page: number; total: number; onPageChange: (page: number) => void }) {
  if (total <= PAGE_SIZE) return null;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const start = page * PAGE_SIZE + 1;
  const end = Math.min((page + 1) * PAGE_SIZE, total);
  return (
    <div className="status-row" style={{ marginTop: 4 }}>
      <span className="muted">Showing {start}–{end} of {total}</span>
      <div className="action-buttons">
        <button type="button" className="button secondary small" disabled={page === 0} onClick={() => onPageChange(Math.max(0, page - 1))}><ChevronLeft size={14} /> Prev</button>
        <button type="button" className="button secondary small" disabled={page + 1 >= totalPages} onClick={() => onPageChange(page + 1)}>Next <ChevronRight size={14} /></button>
      </div>
    </div>
  );
}
