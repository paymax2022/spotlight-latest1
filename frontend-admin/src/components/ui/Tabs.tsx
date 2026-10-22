import { colors } from '@/components/ui/vuexy';

export interface TabItem {
  key: string;
  label: string;
}

export function Tabs({ items, active, onChange }: { items: TabItem[]; active: string; onChange: (key: string) => void }) {
  return (
    <div style={{ display: 'flex', gap: '0.25rem', borderBottom: `1px solid ${colors.border}`, marginBottom: '1rem', overflowX: 'auto' }}>
      {items.map((item) => {
        const isActive = item.key === active;
        return (
          <button
            key={item.key}
            onClick={() => onChange(item.key)}
            style={{
              padding: '0.6rem 1rem',
              fontSize: '0.85rem',
              fontWeight: 600,
              background: 'none',
              border: 'none',
              borderBottom: `2px solid ${isActive ? colors.primary : 'transparent'}`,
              color: isActive ? colors.primary : colors.muted,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
