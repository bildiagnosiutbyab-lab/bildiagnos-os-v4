import { useEffect, useState } from 'react';
import { translateUi } from './uiTranslations.js';
import Sidebar from './Sidebar.jsx';
import Dashboard from './Dashboard.jsx';
import WorkOrders from './WorkOrders.jsx';
import Customers from './Customers.jsx';
import Vehicles from './Vehicles.jsx';
import Parts from './Parts.jsx';
import Calendar from './Calendar.jsx';
import AuthGate from './AuthGate.jsx';
import Lager from './Lager.jsx';

export default function App() {
  const [page, setPage] = useState('dashboard');
  const [language, setLanguage] = useState(() => localStorage.getItem('bildiagnos-language') || 'sv');
  const changeLanguage = (next) => { localStorage.setItem('bildiagnos-language', next); setLanguage(next); };

  useEffect(() => {
    document.documentElement.lang = language === 'es' ? 'es' : 'sv';
    const apply = () => translateUi(document.body, language);
    apply();
    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.addedNodes?.length)) {
        window.requestAnimationFrame(apply);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [language]);

  return (
    <AuthGate>
      <div className="app-shell">
        <Sidebar active={page} onChange={setPage} language={language} onLanguageChange={changeLanguage} />

        <main className="main-content">
          {page === 'dashboard' && (
            <Dashboard onNewOrder={() => setPage('orders')} />
          )}

          {page === 'orders' && <WorkOrders />}
          {page === 'customers' && <Customers />}
          {page === 'vehicles' && <Vehicles />}
          {page === 'parts' && <Parts />}
          {page === 'lager' && <Lager />}
          {page === 'calendar' && <Calendar />}
        </main>
      </div>
    </AuthGate>
  );
}
