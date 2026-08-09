/** Returns 4 for IPv4, 6 for IPv6, 0 if not an IP (Node `net.isIP` compatible). */
export function isIP(value: string): 0 | 4 | 6 {
  const trimmed = value.trim();
  if (!trimmed) {
    return 0;
  }
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(trimmed)) {
    const parts = trimmed.split('.').map(Number);
    if (parts.every((part) => part >= 0 && part <= 255)) {
      return 4;
    }
    return 0;
  }
  // Bracketed form is invalid for bare IP checks.
  if (trimmed.startsWith('[') || trimmed.includes('%')) {
    return 0;
  }
  // Loose IPv6: must contain ':' and only hex/colon characters.
  if (/^[0-9a-fA-F:]+$/.test(trimmed) && trimmed.includes(':')) {
    try {
      // URL parser accepts IPv6 in brackets.
      // eslint-disable-next-line no-new
      new URL(`http://[${trimmed}]/`);
      return 6;
    } catch {
      return 0;
    }
  }
  return 0;
}
