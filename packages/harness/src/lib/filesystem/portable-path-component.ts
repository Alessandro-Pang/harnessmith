const maximumPortablePathComponentBytes = 255;
const maximumPortablePathComponentCodeUnits = 255;
export const maximumPortableIdentityCharacters = 100;

const portableIdentityCharacters = /^[a-z0-9][a-z0-9._-]*$/;
const windowsDeviceBasename = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const windowsForbiddenCharacters = '<>:"/\\|?*';

function hasWindowsForbiddenCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      (codePoint !== undefined && codePoint <= 0x1f) ||
      windowsForbiddenCharacters.includes(character)
    );
  });
}

export function isPortablePathComponent(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= maximumPortablePathComponentCodeUnits &&
    Buffer.byteLength(value, 'utf8') <= maximumPortablePathComponentBytes &&
    value !== '.' &&
    value !== '..' &&
    !/[. ]$/.test(value) &&
    !windowsDeviceBasename.test(value) &&
    !hasWindowsForbiddenCharacter(value)
  );
}

export function isPortableIdentityComponent(
  value: string,
  {
    minimumCharacters = 1,
    maximumCharacters = maximumPortableIdentityCharacters,
  }: { minimumCharacters?: number; maximumCharacters?: number } = {},
): boolean {
  return (
    value.length >= minimumCharacters &&
    value.length <= maximumCharacters &&
    portableIdentityCharacters.test(value) &&
    isPortablePathComponent(value)
  );
}
