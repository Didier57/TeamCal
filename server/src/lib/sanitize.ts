import sanitizeHtml from 'sanitize-html';

const allowedTags = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'a', 'h1', 'h2', 'h3', 'blockquote', 'code', 'pre'];

export function cleanDescription(input: string | null | undefined, allowHtml: boolean): string {
  if (!input) return '';
  if (!allowHtml) {
    return sanitizeHtml(input, { allowedTags: [], allowedAttributes: {} }).trim();
  }
  return sanitizeHtml(input, {
    allowedTags,
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer', target: '_blank' })
    }
  }).trim();
}

export function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}
