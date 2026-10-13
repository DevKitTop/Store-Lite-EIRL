import styles from './SolutionsSection.module.css';

const CARDS = [
  {
    icon: 'rocket_launch',
    issue: 'Crear una tienda online cuesta caro y toma semanas.',
    fix: 'Empieza gratis, sin mensualidad ni sorpresas.',
  },
  {
    icon: 'payments',
    issue: 'Te complicas con pagos y cobros.',
    fix: 'Pagos directos y seguros, integrados con Culqi.',
  },
  {
    icon: 'local_shipping',
    issue: 'Gestionar envíos es un dolor de cabeza.',
    fix: 'Supervisa pedidos desde que los envías hasta que llegan a tus usuarios. Más seguridad y tranquilidad para tus clientes.',
  },
  {
    icon: 'inventory_2',
    issue: 'Pierdes productos y stock en hojas de cálculo.',
    fix: 'Tu catálogo siempre al día, sin esfuerzo.',
  },
  {
    icon: 'insights',
    issue: 'No sabes qué está funcionando o qué no.',
    fix: 'En tiempo real puedes estar en contacto con tus usuarios porque tenemos chats en tiempo real.',
  },
] as const;

const INTEGRATIONS = [
  { icon: 'credit_card', name: 'Culqi', cat: 'Pagos' },
  { icon: 'percent', name: '0 comisiones', cat: 'Por venta' },
  { icon: 'travel_explore', name: 'Google', cat: 'Subdominio' },
  { icon: 'edit', name: 'Edita tu negocio', cat: 'A tu comodidad' },
] as const;

export default function SolutionsSection() {
  return (
    <section className={styles.section} id="soluciones">
      <div className={styles.wrap}>
        <div className={styles.sectionHead}>
          <h2>
            <span className="material-symbols-rounded" aria-hidden="true">
              hub
            </span>
            Todo lo que necesitas, conectado
          </h2>
          <p>
            Crear y mantener un ecommerce no debería ser un proyecto de ingeniería. Store Lite te da
            lo que necesitas, sin lo que no.
          </p>
        </div>

        <div className={styles.cardGrid}>
          {CARDS.map((card) => (
            <article className={styles.infoCard} key={card.issue}>
              <div className={styles.iconChip}>
                <span className="material-symbols-rounded">{card.icon}</span>
              </div>
              <p className={styles.issue}>{card.issue}</p>
              <div className={styles.fixRow}>
                <span className="material-symbols-rounded">check_circle</span>
                <p>{card.fix}</p>
              </div>
            </article>
          ))}
        </div>

        <div className={styles.intRow}>
          {INTEGRATIONS.map((int) => (
            <div className={styles.intChip} key={int.name}>
              <div className={styles.intChipIcon}>
                <span className="material-symbols-rounded">{int.icon}</span>
              </div>
              <div className={styles.intName}>{int.name}</div>
              <div className={styles.intCat}>{int.cat}</div>
            </div>
          ))}
        </div>

        <p className={styles.intMore}>+ Más integraciones próximamente</p>
      </div>
    </section>
  );
}
