/** Remove the extra separator pnpm forwards for `pnpm run <script> -- ...`. */
export function normalizeEvalGateArgs(args: string[]): string[] {
  const commandIndex = args.findIndex((value) => !value.startsWith('-'));
  if (commandIndex < 0) return args;
  const separatorIndex = args.findIndex((value, index) => index > commandIndex && value === '--');
  if (separatorIndex < 0) return args;
  const previous = args[separatorIndex - 1];
  const next = args[separatorIndex + 1];
  if (previous?.startsWith('--') || !next?.startsWith('--')) return args;
  return [...args.slice(0, separatorIndex), ...args.slice(separatorIndex + 1)];
}
