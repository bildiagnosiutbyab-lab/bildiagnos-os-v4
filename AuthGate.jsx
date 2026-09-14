import { useEffect, useState } from 'react';
import { supabase } from './supabaseClient.js';

const OWNER_EMAIL = 'bildiagnosiutbyab@gmail.com';

export default function AuthGate({ children }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session);
        setLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  async function signIn(event) {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');

    const { error } = await supabase.auth.signInWithPassword({
      email: OWNER_EMAIL,
      password,
    });

    setSubmitting(false);

    if (error) {
      setMessage('No se pudo iniciar sesión. Revisa la contraseña.');
    }
  }

  async function createAccount() {
    if (password.length < 6) {
      setMessage('La contraseña debe tener al menos 6 caracteres.');
      return;
    }

    setSubmitting(true);
    setMessage('');

    const { data, error } = await supabase.auth.signUp({
      email: OWNER_EMAIL,
      password,
    });

    setSubmitting(false);

    if (error) {
      setMessage(error.message);
      return;
    }

    if (!data.session) {
      setMessage(
        'Cuenta creada. Abre el correo de confirmación y después inicia sesión.'
      );
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
  }

  if (loading) {
    return (
      <main className="auth-screen">
        <section className="card auth-card">
          <h1>Bildiagnos OS</h1>
          <p>Conectando con el taller…</p>
        </section>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="auth-screen">
        <form className="card auth-card" onSubmit={signIn}>
          <h1>Bildiagnos OS</h1>
          <p>Inicia sesión para sincronizar el taller en todos tus dispositivos.</p>

          <label>
            Correo
            <input type="email" value={OWNER_EMAIL} readOnly />
          </label>

          <label>
            Contraseña
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength="6"
              autoComplete="current-password"
              required
            />
          </label>

          {message && <p className="auth-message">{message}</p>}

          <button className="primary-button" type="submit" disabled={submitting}>
            {submitting ? 'Conectando…' : 'Iniciar sesión'}
          </button>

          <button
            className="secondary-button"
            type="button"
            onClick={createAccount}
            disabled={submitting}
          >
            Crear mi cuenta
          </button>
        </form>
      </main>
    );
  }

  return (
    <>
      <div className="cloud-session-bar">
        <span>Sincronización activa</span>
        <button type="button" onClick={signOut}>
          Cerrar sesión
        </button>
      </div>
      {children}
    </>
  );
}
