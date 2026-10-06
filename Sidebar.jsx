import { LayoutDashboard, ClipboardList, Users, Car, PackageSearch, CalendarDays, Boxes } from 'lucide-react';

const labels = {
  sv: { dashboard: 'Översikt', orders: 'Arbetsorder', customers: 'Kunder', vehicles: 'Fordon', parts: 'Reservdelar', lager: 'Lager', calendar: 'Kalender', subtitle: 'Verkstadsystem' },
  es: { dashboard: 'Inicio', orders: 'Órdenes', customers: 'Clientes', vehicles: 'Vehículos', parts: 'Piezas', lager: 'Inventario', calendar: 'Calendario', subtitle: 'Sistema del taller' },
};
const items = [['dashboard', LayoutDashboard], ['orders', ClipboardList], ['customers', Users], ['vehicles', Car], ['parts', PackageSearch], ['lager', Boxes], ['calendar', CalendarDays]];

export default function Sidebar({ active, onChange, language = 'sv', onLanguageChange }) {
  const t = labels[language] || labels.sv;
  return (
    <aside className="sidebar">
      <div>
        <div className="brand">Bildiagnos OS</div>
        <div className="brand-subtitle">{t.subtitle}</div>
      </div>

      <nav className="nav">
        {items.map(([key, Icon]) => (
          <button
            key={key}
            className={active === key ? 'nav-item active' : 'nav-item'}
            onClick={() => onChange(key)}
          >
            <Icon size={19} />
            <span>{t[key]}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-footer"><button type="button" onClick={() => onLanguageChange?.(language === 'sv' ? 'es' : 'sv')}>{language === 'sv' ? '🇪🇸 Español' : '🇸🇪 Svenska'}</button><span> · v0.1</span></div>
    </aside>
  );
}
