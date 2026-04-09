import { faker } from '@faker-js/faker';

const FALLBACK_IMAGE_URL = 'https://example.com/image-placeholder.jpg';

export function getFixedImageUrls(): string[] {
  const raw = process.env.FIXED_IMAGE_URL?.trim();
  if (!raw) {
    return [];
  }

  if (raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return normalizeUrlList(parsed);
      }
    } catch {
      return [];
    }
  }

  return normalizeUrlList(raw.split(/[\r\n,]+/));
}

export function pickImageUrl(source = getFixedImageUrls()): string {
  if (source.length === 0) {
    return FALLBACK_IMAGE_URL;
  }

  return faker.helpers.arrayElement(source);
}

export function pickRandomImageSubset(source = getFixedImageUrls()): string[] {
  if (source.length === 0) {
    return [];
  }

  if (source.length <= 3) {
    return [...source];
  }

  const count = faker.number.int({ min: 3, max: source.length });
  return faker.helpers.arrayElements(source, count);
}

function normalizeUrlList(input: unknown[]): string[] {
  return input
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}
