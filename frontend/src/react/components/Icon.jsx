export function Icon({ children, className = '' }) {
  return <span className={`material-symbols-outlined${className ? ` ${className}` : ''}`} aria-hidden="true">{children}</span>
}
