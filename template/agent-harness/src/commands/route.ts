import { routeDocumentation } from '../lib/docs-routing.js';
import type { Io, Runtime } from '../types.js';

export function route(
  runtime: Runtime,
  query: string[],
  { json = false }: { json?: boolean } = {},
  io: Io = console,
): number {
  const report = routeDocumentation(runtime.docsRoot, query);
  if (json) io.log(JSON.stringify(report, null, 2));
  else if (report.routes.length === 0) io.log('No matching documentation routes');
  else {
    for (const match of report.routes) {
      io.log(`${match.name}: ${match.path} [${match.matchedTriggers.join(', ')}]`);
    }
  }
  return 0;
}
