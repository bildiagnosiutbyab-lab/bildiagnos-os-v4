export default function PageHeader({
  title,
  subtitle,
  action,
  onAction
}) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>

      {action && (
        <button
          className="primary-button"
          onClick={onAction}
        >
          {action}
        </button>
      )}
    </header>
  );
}