import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { ExchangeRateProvider } from './context/ExchangeRateContext';
import { SystemConfigProvider } from './context/SystemConfigContext';
import { DatabaseProvider } from './context/DatabaseContext';
import { ThemeProvider } from './context/ThemeContext';
import { PersonasAdminApp } from './components/AdminPersonas/PersonasAdminApp';
import { AdminEmpresasApp } from './components/AdminEmpresasApp';

// Hidden admin URL: /admin-personas — runs in TOTAL isolation,
// no Empresas providers, no Empresas auth.
const isPersonasAdminRoute =
  typeof window !== 'undefined' &&
  window.location.pathname.startsWith('/admin-personas');

// /admin-empresas (y /admin): panel admin de la app con SU PROPIO login,
// aislado del routing de la app de clientes (evita los bugs de ingreso
// por redirecciones de rol/splash). OJO: chequear DESPUÉS de personas —
// '/admin-personas' también empieza por '/admin'.
const isEmpresasAdminRoute =
  typeof window !== 'undefined' &&
  !isPersonasAdminRoute &&
  (window.location.pathname === '/admin-empresas' || window.location.pathname === '/admin');

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: any) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#F8FAFC', padding: '2rem', fontFamily: 'sans-serif' }}>
          <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '1rem', padding: '2rem', maxWidth: '480px', width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
            <div style={{ color: '#0F172A', fontWeight: 800, fontSize: '1.25rem', marginBottom: '0.5rem' }}>Algo salió mal</div>
            <div style={{ color: '#64748b', fontSize: '0.875rem', marginBottom: '1rem' }}>Ocurrió un error inesperado. Por favor recarga la página.</div>
            <details style={{ color: '#94a3b8', fontSize: '0.75rem', marginBottom: '1rem' }}>
              <summary style={{ cursor: 'pointer' }}>Detalles del error</summary>
              <pre style={{ marginTop: '0.5rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{this.state.error.message}</pre>
            </details>
            <button onClick={() => window.location.reload()} style={{ background: '#0F172A', color: 'white', border: 'none', borderRadius: '0.75rem', padding: '0.75rem 1.5rem', fontWeight: 700, fontSize: '0.875rem', cursor: 'pointer', width: '100%' }}>
              Recargar página
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      {isPersonasAdminRoute ? (
        // 🔒 Admin Personas: independiente, sin providers de Empresas
        <PersonasAdminApp />
      ) : isEmpresasAdminRoute ? (
        // 🏢🔒 Admin Empresas: login propio + AdminDashboard, sin pasar
        // por la landing ni el routing por roles de App.tsx
        <AdminEmpresasApp />
      ) : (
        // 🏢 Flujo normal (Empresas + Landing + Login + Dashboards)
        <ThemeProvider>
          <SystemConfigProvider>
            <DatabaseProvider>
              <ExchangeRateProvider>
                <App />
              </ExchangeRateProvider>
            </DatabaseProvider>
          </SystemConfigProvider>
        </ThemeProvider>
      )}
    </ErrorBoundary>
  </React.StrictMode>
);