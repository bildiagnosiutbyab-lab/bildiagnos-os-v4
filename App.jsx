import { useState } from 'react';
import Sidebar from './Sidebar.jsx';
import Dashboard from './Dashboard.jsx';
import WorkOrders from './WorkOrders.jsx';
import Customers from './Customers.jsx';
import Vehicles from './Vehicles.jsx';
import Parts from './Parts.jsx';
import Catalogs from './Catalogs.jsx';
import AuthGate from './AuthGate.jsx';

export default function App() {
  const [page, setPage] = useState('dashboard');

  return (
    <AuthGate>
      <div className="app-shell">
        <Sidebar active={page} onChange={setPage} />

        <main className="main-content">
          {page === 'dashboard' && (
            <Dashboard onNewOrder={() => setPage('orders')} />
          )}

          {page === 'orders' && <WorkOrders />}
          {page === 'customers' && <Customers />}
          {page === 'vehicles' && <Vehicles />}
          {page === 'parts' && <Parts />}
          {page === 'catalogs' && <Catalogs />}
        </main>
      </div>
    </AuthGate>
  );
}
