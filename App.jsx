import { Component, useEffect, useState } from 'react';
import Sidebar from './Sidebar.jsx';
import Dashboard from './Dashboard.jsx';
import WorkOrders from './WorkOrders.jsx';
import Customers from './Customers.jsx';
import Vehicles from './Vehicles.jsx';
import Parts from './Parts.jsx';
import Calendar from './Calendar.jsx';
import AuthGate from './AuthGate.jsx';
import Lager from './Lager.jsx';
import WorkshopTimer from './WorkshopTimer.jsx';

class ScreenErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error, info) { console.error('Bildiagnos screen error', error, info); }
  componentDidUpdate(prevProps) {
    if (prevProps.page !== this.props.page && this.state.failed) this.setState({ failed: false });
  }
  render() {
    if (this.state.failed) return <section className="card" role="alert">
      <h2>No se pudo abrir esta pantalla</h2>
      <p>Los datos guardados no se han eliminado. Puedes volver a intentar o entrar a otra sección.</p>
      <button type="button" className="primary-button" onClick={() => this.setState({ failed: false })}>Reintentar</button>
    </section>;
    return this.props.children;
  }
}

export default function App() {
  const [page, setPage] = useState('dashboard');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [language, setLanguage] = useState(() => localStorage.getItem('bildiagnos-language') || 'sv');
  const changeLanguage = (next) => { localStorage.setItem('bildiagnos-language', next); setLanguage(next); };

  useEffect(() => { document.documentElement.lang = language === 'es' ? 'es' : 'sv'; }, [language]);

  return (
    <AuthGate>
      <div className="app-shell">
        <Sidebar active={page} onChange={setPage} language={language} onLanguageChange={changeLanguage} />

        <main className="main-content"><ScreenErrorBoundary key={page} page={page}>
          {page === 'dashboard' && (
            <Dashboard onNewOrder={() => setPage('orders')} />
          )}

          {page === 'orders' && <WorkOrders initialPlate={vehiclePlate} onPlateConsumed={() => setVehiclePlate('')} />}
          {page === 'reports' && <WorkOrders initialView="report" />}
          {page === 'customers' && <Customers />}
          {page === 'vehicles' && <Vehicles onOpenPlate={plate => { setVehiclePlate(plate); setPage('orders'); }} />}
          {page === 'parts' && <Parts />}
          {page === 'lager' && <Lager />}
          {page === 'workshop' && <WorkshopTimer language={language} />}
          {page === 'calendar' && <Calendar />}
        </ScreenErrorBoundary></main>
      </div>
    </AuthGate>
  );
}
