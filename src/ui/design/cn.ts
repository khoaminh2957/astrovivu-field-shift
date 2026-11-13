import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/*
 * tailwind-merge must know the names this system adds to the theme, otherwise `text-2xs` is read as
 * a colour and silently dropped when a real colour class follows it.
 */
const merge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['2xs', 'md'],
    },
  },
});

/** Class composer for every primitive: conditional classes in, conflicts resolved, last one wins. */
export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
