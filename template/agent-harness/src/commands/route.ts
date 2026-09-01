import { routeDocumentation } from '../lib/docs-routing.js';
import { assertNoHighConfidenceSecret } from '../lib/secret-hygiene.js';
import type { Io, Runtime } from '../types.js';

export function route(
  runtime: Runtime,
  query: string[],
  { json = false }: { json?: boolean } = {},
  io: Io = console,
): number {
  assertNoHighConfidenceSecret(query, 'Documentation route query');
  const report = routeDocumentation(runtime.docsRoot, query);
  if (json) io.log(JSON.stringify(report, null, 2));
  else if (report.status === 'unmatched') io.log('No matching documentation routes');
  else if (report.status === 'ambiguous') {
    io.log(`Ambiguous documentation playbooks: ${report.ambiguity.join(', ')}`);
  } else {
    for (const match of report.routes) {
      io.log(`${match.name}: ${match.path} [${match.matchedAliases.join(', ')}]`);
    }
  }
  return report.status === 'matched' ? 0 : 2;
}
