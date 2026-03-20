// Shared API naming utilities used by both networking-generator and swiftui-generator.
// Extracted to break circular dependency between the two generators.
// Contains its own pascalCase to avoid importing from either generator.

import type { ApiEndpoint } from '../semantic/model';

function pascalCase(s: string): string {
    if (/^[A-Z][a-zA-Z0-9]*$/.test(s) && !/_|-|\s/.test(s)) return s;
    if (/^[a-z][a-zA-Z0-9]*$/.test(s) && !/_|-|\s/.test(s)) return s.charAt(0).toUpperCase() + s.slice(1);
    return s
        .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
        .replace(/^[a-z]/, (c) => c.toUpperCase());
}

/**
 * Clean a raw URL string (potentially from JS template literals) into a
 * REST-style path suitable for Swift code generation.
 *
 * Examples:
 *   "`${API_BASE}/products/${id}`"          →  "/products/:id"
 *   "`${API_BASE}/products/search?q=${encodeURIComponent(query)}`"
 *                                   →  "/products/search"
 */
export function cleanURL(raw: string): string | null {
    let url = raw.trim();

    if (url.startsWith('`') && url.endsWith('`')) {
        url = url.slice(1, -1);
    }

    url = url.replace(/^\$\{[A-Za-z_][A-Za-z0-9_]*\}/, '');

    url = url.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
        const simpleVar = expr.match(/^([a-zA-Z_][a-zA-Z0-9_]*)$/);
        if (simpleVar) return `:${simpleVar[1]}`;

        const fnCall = expr.match(/\w+\(([a-zA-Z_][a-zA-Z0-9_]*)\)/);
        if (fnCall) return `:${fnCall[1]}`;

        return ':param';
    });

    const queryIdx = url.indexOf('?');
    if (queryIdx !== -1) {
        url = url.substring(0, queryIdx);
    }

    url = url.replace(/\[([a-zA-Z_][a-zA-Z0-9_]*)\]/g, ':$1');
    url = url.replace(/['"]+/g, '').replace(/\s*\+\s*/g, '');

    if (!url.startsWith('/') && !url.startsWith('http')) {
        return null;
    }

    url = url.replace(/\/+/g, '/').replace(/\/$/, '') || '/';

    return url;
}

/** Extract path parameters from a URL pattern (`:param` or `{param}`) */
export function extractPathParams(url: string): string[] {
    const params: string[] = [];
    const seen = new Set<string>();
    const colonMatch = url.match(/:([a-zA-Z_][a-zA-Z0-9_]*)/g);
    if (colonMatch) {
        for (const m of colonMatch) {
            const name = m.slice(1);
            if (!seen.has(name)) {
                seen.add(name);
                params.push(name);
            }
        }
    }
    const braceMatch = url.match(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g);
    if (braceMatch) {
        for (const m of braceMatch) {
            const name = m.slice(1, -1);
            if (!seen.has(name)) {
                seen.add(name);
                params.push(name);
            }
        }
    }
    return params;
}

/** Naive singularize — handles common English plural suffixes */
export function singularize(word: string): string {
    if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
    if (word.endsWith('ses') || word.endsWith('xes') || word.endsWith('zes') ||
        word.endsWith('shes') || word.endsWith('ches')) {
        return word.slice(0, -2);
    }
    if (word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
    return word;
}

/** Compute the Swift function name the networking generator will produce for an endpoint */
export function generateFunctionName(endpoint: ApiEndpoint): string {
    const method = (endpoint.method ?? 'GET').toLowerCase();
    const cleaned = cleanURL(endpoint.url) ?? '/resource';

    const segments = cleaned
        .split('/')
        .filter((s) => s && !s.startsWith(':') && !s.startsWith('{') && !s.startsWith('[') && s !== 'api');

    const resource = segments[segments.length - 1] ?? 'resource';

    const hasPathParam = cleaned.includes(':') || cleaned.includes('{');

    const resourceName = (method === 'get' && hasPathParam)
        ? singularize(resource)
        : resource;

    switch (method) {
        case 'get':
            return `fetch${pascalCase(resourceName)}`;
        case 'post':
            return `create${pascalCase(singularize(resource))}`;
        case 'put':
        case 'patch':
            return `update${pascalCase(singularize(resource))}`;
        case 'delete':
            return `delete${pascalCase(singularize(resource))}`;
        default:
            return `${method}${pascalCase(resource)}`;
    }
}
