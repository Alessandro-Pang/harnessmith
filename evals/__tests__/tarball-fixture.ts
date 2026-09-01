import { lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

export interface TarEntry {
  path: string;
  content: string | Buffer;
  declaredSize?: number;
  linkpath?: string;
  type?: string;
}

function octal(header: Buffer, offset: number, length: number, value: number): void {
  const encoded = `${value.toString(8).padStart(length - 1, '0')}\0`;
  header.write(encoded, offset, length, 'ascii');
}

function tarHeader(path: string, size: number, type = '0', linkpath?: string): Buffer {
  if (Buffer.byteLength(path) > 100) throw new Error(`Fixture tar path is too long: ${path}`);
  if (linkpath && Buffer.byteLength(linkpath) > 100) {
    throw new Error(`Fixture tar link path is too long: ${linkpath}`);
  }
  const header = Buffer.alloc(512);
  header.write(path, 0, 100, 'utf8');
  octal(header, 100, 8, 0o644);
  octal(header, 108, 8, 0);
  octal(header, 116, 8, 0);
  octal(header, 124, 12, size);
  octal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header.write(type, 156, 1, 'ascii');
  if (linkpath) header.write(linkpath, 157, 100, 'utf8');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
  header[154] = 0;
  header[155] = 0x20;
  return header;
}

export function tarGzip(entries: TarEntry[]): Buffer {
  const parts: Buffer[] = [];
  for (const entry of entries) {
    const content = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content, 'utf8');
    parts.push(
      tarHeader(entry.path, entry.declaredSize ?? content.length, entry.type, entry.linkpath),
      content,
    );
    const padding = (512 - (content.length % 512)) % 512;
    if (padding > 0) parts.push(Buffer.alloc(padding));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts), { level: 9 });
}

export function candidateEntries(
  root: string,
  {
    packageVersion,
    harnessVersion,
    rule,
    scenarios,
    hostMatrix,
  }: {
    packageVersion?: string;
    harnessVersion?: string;
    rule?: string;
    scenarios?: unknown;
    hostMatrix?: unknown;
  } = {},
): TarEntry[] {
  const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const harnessManifest = JSON.parse(
    readFileSync(join(root, 'template', 'agent-harness', 'manifest.json'), 'utf8'),
  );
  const scenarioCatalog =
    scenarios ?? JSON.parse(readFileSync(join(root, 'evals', 'scenarios.json'), 'utf8'));
  packageManifest.version = packageVersion ?? packageManifest.version;
  harnessManifest.harnessVersion = harnessVersion ?? harnessManifest.harnessVersion;
  const filesUnder = (path: string): string[] =>
    readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
      const target = join(path, entry.name);
      return entry.isDirectory() ? filesUnder(target) : [target];
    });
  const distributionPaths = (packageManifest.files as string[]).flatMap((path) => {
    const target = join(root, path);
    return lstatSync(target).isDirectory() ? filesUnder(target) : [target];
  });
  const entries: TarEntry[] = [
    {
      path: 'package/package.json',
      content: packageVersion
        ? JSON.stringify(packageManifest)
        : readFileSync(join(root, 'package.json')),
    },
  ];
  for (const path of distributionPaths) {
    const packagePath = `package/${relative(root, path).split('\\').join('/')}`;
    let content: string | Buffer = readFileSync(path);
    if (packagePath === 'package/template/AGENTS.md' && rule !== undefined) content = rule;
    if (packagePath === 'package/template/agent-harness/manifest.json' && harnessVersion) {
      content = JSON.stringify(harnessManifest);
    }
    if (packagePath === 'package/evals/scenarios.json' && scenarios !== undefined) {
      content = JSON.stringify(scenarioCatalog);
    }
    if (
      packagePath === 'package/evals/host-capability-matrix.v1.json' &&
      hostMatrix !== undefined
    ) {
      content = JSON.stringify(hostMatrix);
    }
    entries.push({ path: packagePath, content });
  }
  return entries;
}

export function writeCandidateTarball(
  path: string,
  root: string,
  options: Parameters<typeof candidateEntries>[1] = {},
): void {
  writeFileSync(path, tarGzip(candidateEntries(root, options)));
}
