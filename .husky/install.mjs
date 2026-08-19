import { existsSync } from 'node:fs';

if (process.env.NODE_ENV !== 'production' && process.env.CI !== 'true' && existsSync('.git')) {
  const husky = (await import('husky')).default;
  const message = husky();
  if (message) console.warn(`Husky hooks were not installed: ${message}`);
}
