export interface AtxHeading {
  level: number;
  title: string;
}

export function parseAtxHeading(line: string): AtxHeading | undefined {
  const match = line.match(/^[ \t]{0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/);
  if (!match) return undefined;
  let title = (match[2] || '').trimEnd();
  const closing = title.match(/^(.*?)[ \t]+#+[ \t]*$/);
  if (closing) title = closing[1].trimEnd();
  return { level: match[1].length, title: title.trimStart() };
}

export function isAtxHeading(line: string, level: number, title: string): boolean {
  const heading = parseAtxHeading(line);
  return heading?.level === level && heading.title === title;
}
