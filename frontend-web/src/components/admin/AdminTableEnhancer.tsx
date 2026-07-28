'use client';

import { useEffect } from 'react';

const ENHANCED_ATTR = 'data-admin-table-enhanced';

function cellText(row: HTMLTableRowElement, index: number) {
  return row.cells[index]?.textContent?.trim() ?? '';
}

function compareCell(a: string, b: string, direction: number) {
  const aNumber = Number(a.replace(/[^\d.-]/g, ''));
  const bNumber = Number(b.replace(/[^\d.-]/g, ''));
  const bothNumeric = a.trim() !== '' && b.trim() !== '' && Number.isFinite(aNumber) && Number.isFinite(bNumber);
  if (bothNumeric) return (aNumber - bNumber) * direction;
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }) * direction;
}

function enhanceTable(table: HTMLTableElement) {
  if (table.getAttribute(ENHANCED_ATTR) === 'true') return;
  table.setAttribute(ENHANCED_ATTR, 'true');
  table.classList.add('admin-data-table');

  const wrapper = table.closest('.overflow-x-auto') ?? table.parentElement;
  if (wrapper instanceof HTMLElement) {
    wrapper.classList.add('admin-table-responsive');

    if (!wrapper.previousElementSibling?.classList.contains('admin-table-tools')) {
      const tools = document.createElement('div');
      tools.className = 'admin-table-tools';

      const label = document.createElement('label');
      label.className = 'admin-table-filter';

      const icon = document.createElement('i');
      icon.className = 'fa-solid fa-magnifying-glass';
      icon.setAttribute('aria-hidden', 'true');

      const input = document.createElement('input');
      input.type = 'search';
      input.placeholder = 'Filter table';
      input.setAttribute('aria-label', 'Filter table');

      input.addEventListener('input', () => {
        const term = input.value.trim().toLowerCase();
        table.querySelectorAll<HTMLTableRowElement>('tbody tr').forEach((row) => {
          row.hidden = term.length > 0 && !row.textContent?.toLowerCase().includes(term);
        });
      });

      label.append(icon, input);
      tools.append(label);
      wrapper.parentElement?.insertBefore(tools, wrapper);
    }
  }

  table.querySelectorAll<HTMLTableCellElement>('thead th').forEach((header, index) => {
    if (header.dataset.sortReady === 'true') return;
    header.dataset.sortReady = 'true';
    header.tabIndex = 0;
    header.role = 'button';
    header.classList.add('admin-sortable');
    header.title = 'Sort column';

    const sort = () => {
      const tbody = table.tBodies[0];
      if (!tbody) return;
      const current = header.dataset.sortDirection === 'asc' ? 'desc' : 'asc';
      const direction = current === 'asc' ? 1 : -1;

      table.querySelectorAll<HTMLTableCellElement>('thead th').forEach((cell) => {
        if (cell !== header) cell.removeAttribute('data-sort-direction');
      });
      header.dataset.sortDirection = current;

      Array.from(tbody.rows)
        .sort((a, b) => compareCell(cellText(a, index), cellText(b, index), direction))
        .forEach((row) => tbody.appendChild(row));
    };

    header.addEventListener('click', sort);
    header.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        sort();
      }
    });
  });
}

export default function AdminTableEnhancer() {
  useEffect(() => {
    const enhanceAll = () => {
      document.querySelectorAll<HTMLTableElement>('.admin-theme table').forEach(enhanceTable);
    };

    enhanceAll();
    const observer = new MutationObserver(enhanceAll);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
