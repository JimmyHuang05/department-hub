import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

type MobilePageShellProps = {
  children: ReactNode;
  className?: string;
};

export function MobilePageShell({ children, className = '' }: MobilePageShellProps) {
  return <main className={`mobile-page-shell ${className}`.trim()}>{children}</main>;
}

type MobileHeroProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
};

export function MobileHero({ eyebrow, title, description, action, footer }: MobileHeroProps) {
  return <header className="mobile-hero">
    <div className="mobile-hero__top">
      {eyebrow && <div className="mobile-hero__eyebrow">{eyebrow}</div>}
      {action && <div className="mobile-hero__action">{action}</div>}
    </div>
    <div className="mobile-hero__copy">
      <h1>{title}</h1>
      {description && <div className="mobile-hero__description">{description}</div>}
    </div>
    {footer && <div className="mobile-hero__footer">{footer}</div>}
  </header>;
}

export type MobileMetric = {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  to: string;
};

export function MobileMetricGrid({ items }: { items: MobileMetric[] }) {
  return <nav className="mobile-metric-grid" aria-label="工作台概览">
    {items.map(item => <Link key={item.label} to={item.to} className="mobile-metric">
      {item.icon && <span className="mobile-metric__icon">{item.icon}</span>}
      <strong>{item.value}</strong>
      <span>{item.label}</span>
    </Link>)}
  </nav>;
}

type MobileSectionProps = {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function MobileSection({ title, description, action, children, className = '' }: MobileSectionProps) {
  return <section className={`mobile-section ${className}`.trim()}>
    <div className="mobile-section__header">
      <div className="mobile-section__heading">
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="mobile-section__action">{action}</div>}
    </div>
    <div className="mobile-section__body">{children}</div>
  </section>;
}

type MobileListRowProps = {
  children: ReactNode;
  to?: string;
  onClick?: () => void;
  selected?: boolean;
  className?: string;
};

export function MobileListRow({ children, to, onClick, selected, className = '' }: MobileListRowProps) {
  const classes = `mobile-list-row${selected ? ' is-selected' : ''} ${className}`.trim();
  if (to) return <Link to={to} className={classes}>{children}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={classes}>{children}</button>;
  return <div className={classes}>{children}</div>;
}

export function MobileEmptyState({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return <div className="mobile-empty-state">{icon}<p>{children}</p></div>;
}
