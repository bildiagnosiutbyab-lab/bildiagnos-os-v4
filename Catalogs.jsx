import { ExternalLink } from 'lucide-react';
import PageHeader from './PageHeader.jsx';

const catalogs = [
  {
    name: 'AD Bildelar',
    description: 'AD Sverige katalog',
    href: 'https://katalog.adsverige.com/Account/Login?ReturnUrl=%2F',
  },
  {
    name: 'BilXtra',
    description: 'BilXtra PRO',
    href: 'https://pro.bilxtra.se/',
  },
  {
    name: 'Partslink24',
    description: 'Partslink24 Sverige',
    href: 'https://www.partslink24.com/sv/index.html',
  },
];

export default function Catalogs() {
  return (
    <>
      <PageHeader
        title="Catálogos"
        subtitle="Abre el catálogo del proveedor en una pestaña nueva."
      />
      <section className="catalog-grid" aria-label="Catálogos de proveedores">
        {catalogs.map((catalog) => (
          <article className="card catalog-card" key={catalog.name}>
            <h2>{catalog.name}</h2>
            <p>{catalog.description}</p>
            <a
              className="catalog-link"
              href={catalog.href}
              target="_blank"
              rel="noreferrer"
            >
              Abrir catálogo <ExternalLink size={17} aria-hidden="true" />
            </a>
          </article>
        ))}
      </section>
      <p className="catalog-note">
        El inicio de sesión y la sesión activa se gestionan únicamente por el navegador.
      </p>
    </>
  );
}
