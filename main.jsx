import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

class RootRecovery extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) {
    console.error('Bildiagnos root crash', error, info);
    try { sessionStorage.setItem('bildiagnos-last-crash', String(error?.stack || error)); } catch {}
  }
  render() {
    if (this.state.error) return (
      <main className="auth-screen">
        <section className="card auth-card" role="alert">
          <h1>Bildiagnos: error detectado</h1>
          <p>La aplicación encontró un error. Tus órdenes guardadas no se han borrado.</p>
          <pre style={{whiteSpace:'pre-wrap', overflowWrap:'anywhere', fontSize:12}}>{String(this.state.error?.message || this.state.error)}</pre>
          <button className="primary-button" onClick={() => window.location.reload()}>Volver a abrir</button>
        </section>
      </main>
    );
    return this.props.children;
  }
}

window.addEventListener('unhandledrejection', event => {
  console.error('Bildiagnos unhandled rejection', event.reason);
  try { sessionStorage.setItem('bildiagnos-last-rejection', String(event.reason?.stack || event.reason)); } catch {}
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <RootRecovery><App /></RootRecovery>
);
