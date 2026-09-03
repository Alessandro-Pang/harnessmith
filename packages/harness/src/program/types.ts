export type CommandRunner = <TArgs extends unknown[]>(
  operation: (...args: TArgs) => unknown,
) => (...args: TArgs) => void;
