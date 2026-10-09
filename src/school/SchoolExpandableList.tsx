import { useId, useState, type ReactNode } from 'react';
import { SecondaryButton } from '../ui';

/** A changed student/category resets expansion before the next visible render. */
export function SchoolExpandableList<T>({ items, title, resetKey, renderItem, limit = 5, testId, className = '', asList = false, countLabel, collapseLabel = 'Zwiń' }: {
  items: readonly T[]; title: string; resetKey: string; renderItem: (item: T, index: number) => ReactNode;
  limit?: number; testId?: string; className?: string; asList?: boolean;
  countLabel?: ReactNode; collapseLabel?: string;
}) {
  const id = useId();
  const [state, setState] = useState({ key: resetKey, expanded: false });
  const expanded = state.key === resetKey && state.expanded;
  const visible = expanded ? items : items.slice(0, limit);
  if (!items.length) return null;
  return <section className={`school-expandable-section ${className}`} data-testid={testId} aria-labelledby={`${id}-title`}>
    <div className="school-list-section-heading"><h3 id={`${id}-title`}>{title}</h3><span>{countLabel ?? `${items.length} ${items.length === 1 ? 'wpis' : 'wpisów'}`}</span></div>
    {asList ? <ul id={`${id}-items`} className="school-expandable-items">{visible.map(renderItem)}</ul> : <div id={`${id}-items`} className="school-expandable-items">{visible.map(renderItem)}</div>}
    {items.length > limit && <SecondaryButton className="school-expand-toggle" aria-controls={`${id}-items`} aria-expanded={expanded} aria-label={`${expanded ? collapseLabel : 'Pokaż wszystkie'}: ${title}`} onClick={() => setState({ key: resetKey, expanded: !expanded })}>{expanded ? collapseLabel : `Pokaż wszystkie (${items.length})`}</SecondaryButton>}
  </section>;
}
