import { LayoutDashboard, ClipboardList, Users, Car, PackageSearch, CalendarDays, Boxes } from 'lucide-react';

const items = [
  ['dashboard', 'Översikt', LayoutDashboard],
  ['orders', 'Arbetsorder', ClipboardList],
  ['customers', 'Kunder', Users],
  ['vehicles', 'Fordon', Car],
  ['parts', 'Reservdelar', PackageSearch],
  ['lager', 'Lager', Boxes],
  ['calendar', 'Kalender', CalendarDays]
];

export default function Sidebar({ active, onChange }) {
  return (
    <aside className="sidebar">
      <div>
        <div className="brand">Bildiagnos OS</div>
        <div className="brand-subtitle">Verkstadsystem</div>
      </div>

      <nav className="nav">
        {items.map(([key, label, Icon]) => (
          <button
            key={key}
            className={active === key ? 'nav-item active' : 'nav-item'}
            onClick={() => onChange(key)}
          >
            <Icon size={19} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">SV · v0.1</div>
    </aside>
  );
}
