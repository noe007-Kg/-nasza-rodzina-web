import { useId } from 'react';
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode, SVGProps } from 'react';
import './design-system.css';

export type CardTone = 'rose' | 'violet' | 'blue' | 'mint' | 'gold' | 'neutral';
export type IconName =
  | 'school' | 'calendar' | 'book' | 'grade' | 'homework' | 'test' | 'message'
  | 'activity' | 'sun' | 'clock' | 'arrow-right' | 'chevron-left' | 'chevron-right'
  | 'plus' | 'upload' | 'check' | 'link' | 'shield' | 'users' | 'refresh'
  | 'x' | 'close' | 'heart' | 'bell' | 'document' | 'settings' | 'shopping' | 'task' | 'mail';

const iconPaths: Record<IconName, ReactNode> = {
  school: <><path d="m3 9 9-6 9 6v12H3Z"/><path d="M9 21v-7h6v7M7 10h.01M17 10h.01M7 14h.01M17 14h.01"/><path d="M12 3V1m0 0h5"/></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 11h18M8 15h.01M12 15h.01M16 15h.01M8 18h.01M12 18h.01"/></>,
  book: <><path d="M12 5v16M3 3h4a5 5 0 0 1 5 3 5 5 0 0 1 5-3h4v16h-4a5 5 0 0 0-5 2 5 5 0 0 0-5-2H3Z"/><path d="M6 7h2M16 7h2M6 11h2M16 11h2"/></>,
  grade: <><path d="m12 3 2.8 5.6 6.2.9-4.5 4.4 1.1 6.1L12 17l-5.6 3 1.1-6.1L3 9.5l6.2-.9Z"/></>,
  homework: <><rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 10h6M9 14h3M9 17h6"/></>,
  test: <><path d="M14 4H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m12 11 7.5-7.5a2.1 2.1 0 0 1 3 3L15 14l-4 1ZM8 18h8"/></>,
  message: <><path d="M21 11a8 8 0 0 1-8 8H7l-4 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z"/><path d="M7 8h10M7 12h6"/></>,
  activity: <><path d="M3 12h4l3-8 4 16 3-8h4"/></>,
  sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  'arrow-right': <><path d="M4 12h16m-6-6 6 6-6 6"/></>,
  'chevron-left': <path d="m15 5-7 7 7 7"/>,
  'chevron-right': <path d="m9 5 7 7-7 7"/>,
  plus: <path d="M12 4v16M4 12h16"/>,
  upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  link: <><path d="m10 13 4-4M8.5 15.5l-1 1a3.5 3.5 0 0 1-5-5l4-4a3.5 3.5 0 0 1 5 0M15.5 8.5l1-1a3.5 3.5 0 0 1 5 5l-4 4a3.5 3.5 0 0 1-5 0"/></>,
  shield: <><path d="m12 3 8 3v6c0 4-5 8-8 9-3-1-8-5-8-9V6Z"/><path d="m8 12 3 3 5-6"/></>,
  users: <><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M17 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v3"/></>,
  refresh: <><path d="M20 8a8 8 0 0 0-13-4L3 8m0-5v5h5M4 16a8 8 0 0 0 13 4l4-4m0 5v-5h-5"/></>,
  x: <path d="m6 6 12 12M6 18 18 6"/>,
  close: <path d="m6 6 12 12M6 18 18 6"/>,
  heart: <path d="M20.8 4.8a5.5 5.5 0 0 0-7.8 0L12 6l-1-1.2a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.4a5.5 5.5 0 0 0 0-7.8Z"/>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
  document: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 12h8M8 16h8"/></>,
  settings: <><path d="m9 3-1 3-3 1-2 3 2 2-1 3 3 2 3-1 2 3 3-1 1-3 3-1 2-3-2-2 1-3-3-2-3 1-2-3Z"/><circle cx="12" cy="11" r="3"/></>,
  shopping: <><path d="M3 3h2l3 12h11l2-9H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/></>,
  task: <><rect x="4" y="3" width="16" height="18" rx="3"/><path d="m8 9 2 2 5-5M8 16h8"/></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="3"/><path d="m3 6 9 7 9-7"/></>,
};

/** Decorative by default; pass a title to expose a labelled icon to assistive technology. */
export function Icon({ name, size = 24, title, className = '', ...props }: Omit<SVGProps<SVGSVGElement>, 'name'> & { name: IconName; size?: number; title?: string }) {
  const titleId = useId();
  return <svg {...props} className={`family-icon ${className}`.trim()} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} aria-labelledby={title ? titleId : undefined} focusable="false">
    {title && <title id={titleId}>{title}</title>}{iconPaths[name]}
  </svg>;
}

export function Card({ as: Element = 'article', tone = 'neutral', className = '', children, ...props }: HTMLAttributes<HTMLElement> & { as?: 'section' | 'article' | 'div'; tone?: CardTone }) {
  return <Element {...props} className={`family-card family-card--${tone} ${className}`.trim()}>{children}</Element>;
}

export type StatCardProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'children' | 'value'> & {
  label: string;
  value: ReactNode;
  preview?: ReactNode;
  icon?: IconName;
  tone?: CardTone;
  onClick?: () => void;
  active?: boolean;
  className?: string;
  badge?: ReactNode;
};

export function StatCard({ label, value, preview, icon, tone = 'neutral', onClick, active, className = '', badge, 'aria-describedby': describedBy, ...props }: StatCardProps) {
  const descriptionId = useId();
  const description = `${describedBy || ''} ${descriptionId}-value ${preview != null ? `${descriptionId}-preview` : ''}`.trim();
  const contents = <>
    <span className="family-stat-card__top">
      {icon && <span className="family-stat-card__icon"><Icon name={icon} size={26}/></span>}
      {badge && <span className="family-stat-card__badge">{badge}</span>}
      {onClick && <Icon className="family-stat-card__arrow" name="arrow-right" size={19}/>}
    </span>
    <strong className="family-stat-card__value family-stat-value" id={`${descriptionId}-value`}>{value}</strong>
    <span className="family-stat-card__label">{label}</span>
    {preview != null && <span className="family-stat-card__preview" id={`${descriptionId}-preview`}>{preview}</span>}
  </>;
  const classes = `family-card family-stat-card family-card--${tone} ${active ? 'is-active' : ''} ${className}`.trim();
  return onClick
    ? <button {...props} type="button" className={classes} onClick={onClick} aria-pressed={active} aria-label={label} aria-describedby={description}>{contents}</button>
    : <article {...props} className={classes} aria-label={label} aria-describedby={description}>{contents}</article>;
}

export type FamilyProfile = { key: string; label: string; photoURL?: string; avatar?: string; caption?: string };

export function ProfileSelector({ profiles, value, onChange, className = '', label = 'Wybierz osobę' }: { profiles: FamilyProfile[]; value: string; onChange: (key: string) => void; className?: string; label?: string }) {
  return <div className={`family-profile-selector ${className}`.trim()} role="group" aria-label={label}>
    {profiles.map(profile => <button key={profile.key} type="button" aria-label={profile.label} aria-pressed={value === profile.key} className={`family-profile ${value === profile.key ? 'is-active' : ''}`} onClick={() => onChange(profile.key)}>
      <span className="family-profile__avatar" aria-hidden="true"><span>{profile.avatar || profile.label.slice(0, 1)}</span>{profile.photoURL && <img src={profile.photoURL} alt="" loading="lazy" decoding="async" onError={event => { event.currentTarget.hidden = true; }}/>}</span>
      <span className="family-profile__name">{profile.label}</span>
      {profile.caption && <span className="family-profile__caption">{profile.caption}</span>}
    </button>)}
  </div>;
}

export function SectionHeader({ title, description, eyebrow, icon, actions, className = '', id, level = 1 }: { title: string; description?: string; eyebrow?: string; icon?: IconName; actions?: ReactNode; className?: string; id?: string; level?: 1 | 2 | 3 }) {
  const Heading = level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3';
  return <header className={`family-section-header ${className}`.trim()}>
    <div className="family-section-header__intro">
      {icon && <span className="family-section-header__icon"><Icon name={icon} size={30}/></span>}
      <div className="family-section-header__copy">
        {eyebrow && <p className="family-section-header__eyebrow">{eyebrow}</p>}
        <Heading id={id}>{title}</Heading>
        {description && <p className="family-section-header__description">{description}</p>}
      </div>
    </div>
    {actions && <div className="family-section-header__actions">{actions}</div>}
  </header>;
}

export type StatusTone = 'success' | 'important' | 'warning' | 'error' | 'neutral';

export function StatusPill({ tone = 'neutral', children, className = '', ...props }: HTMLAttributes<HTMLSpanElement> & { tone?: StatusTone }) {
  return <span {...props} className={`family-status-pill family-status-pill--${tone} ${className}`.trim()}><span className="family-status-pill__dot" aria-hidden="true"/>{children}</span>;
}

type FamilyButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { icon?: IconName };

export function PrimaryButton({ icon, type = 'button', className = '', children, ...props }: FamilyButtonProps) {
  return <button {...props} type={type} className={`family-button family-primary-button ${className}`.trim()}>{icon && <Icon name={icon} size={20}/>}<span>{children}</span></button>;
}

export function SecondaryButton({ icon, type = 'button', className = '', children, ...props }: FamilyButtonProps) {
  return <button {...props} type={type} className={`family-button family-secondary-button ${className}`.trim()}>{icon && <Icon name={icon} size={20}/>}<span>{children}</span></button>;
}
