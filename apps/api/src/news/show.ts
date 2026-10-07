/** Whose show the daily rundown is. Read out in the opening and the sign-off, and shown on screen. */
export interface Show {
  name: string;
  host: string;
  /** Handles, without the @ or the site address. */
  x: string;
  github: string;
  linkedin: string;
}

export const DEFAULT_SHOW: Show = {
  name: 'AI Daily',
  host: 'Yash Kavaiya',
  x: 'yashkavaiya',
  github: 'Yash-Kavaiya',
  linkedin: 'yashkavaiya',
};
