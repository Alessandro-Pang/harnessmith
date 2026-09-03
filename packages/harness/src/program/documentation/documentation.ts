import { type Command, Option } from 'commander';
import { route } from '../../commands/routing/route.js';
import {
  type DocumentationIntent,
  documentationIntents,
} from '../../lib/documentation/docs-routing.js';
import type { Io, Runtime } from '../../types.js';
import type { CommandRunner } from '../types.js';

export function registerDocumentationCommands(
  program: Command,
  runtime: Runtime,
  io: Io,
  run: CommandRunner,
): void {
  for (const [name, description] of [
    ['route', 'route task terms to relevant Harness documentation'],
    ['explain', 'explain which Harness documents govern a topic without loading their bodies'],
  ] as const) {
    program
      .command(`${name} <query...>`)
      .description(description)
      .option('--json', 'write machine-readable routes without document bodies')
      .addOption(
        new Option('--intent <intent>', 'validated primary documentation intent').choices([
          ...documentationIntents,
        ]),
      )
      .action(
        run((query: string[], options: { json?: boolean; intent?: DocumentationIntent }) =>
          route(runtime, query, options, io),
        ),
      );
  }
}
