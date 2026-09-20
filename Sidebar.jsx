import { LayoutDashboard, ClipboardList, Users, Car, PackageSearch, CalendarDays } from 'lucide-react';

const items = [
  ['dashboard', 'Inicio', LayoutDashboard],
  ['orders', 'Órdenes', ClipboardList],
  ['customers', 'Clientes', Users],
  ['vehicles', 'Vehículos', Car],
  ['parts', 'Piezas', PackageSearch],
  ['calendar', 'Calendario', CalendarDays]
];

export default function Sidebar({ active, onChange }) {
  return (
    <aside className="sidebar">
      <div>
        <div className="brand">Bildiagnos OS</div>
        <div className="brand-subtitle">Workshop management</div>
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

      <div className="sidebar-footer">ES / SV · v0.1</div>
    </aside>
  );
}
