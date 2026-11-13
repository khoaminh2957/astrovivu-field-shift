import type { ReactNode } from 'react';
import { cn } from '../cn';

/** A top-level section of the style guide, addressable from the nav. */
export function Section({ id, title, note, children }: { id: string; title: ReactNode; note?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-16 border-t border-line-1 pt-10 pb-14">
      <h2 id={`${id}-h`} className="text-2xl font-semibold tracking-tight text-ink-1">
        {title}
      </h2>
      {note != null && <p className="t-reading mt-2 max-w-[68ch] text-ink-2">{note}</p>}
      <div className="mt-8 flex flex-col gap-12">{children}</div>
    </section>
  );
}

/** A group inside a section: heading, the rule that governs it, then specimens. */
export function Group({ title, note, children, className }: { title: ReactNode; note?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className="min-w-0">
      <h3 className="t-title">{title}</h3>
      {note != null && <p className="mt-1 max-w-[68ch] text-sm text-ink-2">{note}</p>}
      <div className={cn('mt-4', className)}>{children}</div>
    </div>
  );
}

/** One specimen with the name of what it shows underneath. */
export function Spec({ name, children, className }: { name: ReactNode; children: ReactNode; className?: string }) {
  return (
    <figure className={cn('m-0 flex min-w-0 flex-col gap-2', className)}>
      <div className="min-w-0">{children}</div>
      <figcaption className="t-caption">{name}</figcaption>
    </figure>
  );
}

/** Token name set as code. */
export function Token({ children }: { children: ReactNode }) {
  return <code className="t-meta text-ink-2">{children}</code>;
}
