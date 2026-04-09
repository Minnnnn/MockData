type ClassValue = unknown;

export function cn(...inputs: ClassValue[]) {
  const hasFunction = inputs.some((item) => typeof item === 'function');
  if (hasFunction) {
    return ((...args: unknown[]) =>
      inputs
        .map((item) => (typeof item === 'function' ? item(...args) : item))
        .filter(Boolean)
        .map((item) => String(item))
        .join(' ')) as any;
  }

  return inputs.filter(Boolean).map((item) => String(item)).join(' ') as any;
}
