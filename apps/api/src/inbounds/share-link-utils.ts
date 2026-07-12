export function formatUriHost(host: string): string {
  if (host.startsWith('[') && host.endsWith(']')) {
    return host;
  }
  return host.includes(':') ? `[${host}]` : host;
}

export function rfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}
