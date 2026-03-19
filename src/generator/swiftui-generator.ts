// Morphkit SwiftUI View Generator
// Transforms Semantic App Model screens into idiomatic SwiftUI views

import type {
    SemanticAppModel,
    Screen,
    Entity,
    LayoutType,
    ConfidenceLevel,
    TypeDefinition,
    DataRequirement,
    UserAction,
    StatePattern,
    ComponentRef,
    Field,
} from '../semantic/model';

export interface GeneratedFile {
    path: string;
    content: string;
    sourceMapping: string;
    confidence: 'high' | 'medium' | 'low';
    warnings: string[];
}

// ---------------------------------------------------------------------------
// Type mapping helpers
// ---------------------------------------------------------------------------

const COMPONENT_MAP: Record<string, string> = {
    button: 'Button',
    text: 'Text',
    image: 'AsyncImage',
    'text-field': 'TextField',
    'secure-field': 'SecureField',
    toggle: 'Toggle',
    picker: 'Picker',
    slider: 'Slider',
    stepper: 'Stepper',
    divider: 'Divider',
    spacer: 'Spacer',
    'progress-view': 'ProgressView',
    label: 'Label',
    link: 'Link',
    'date-picker': 'DatePicker',
    'color-picker': 'ColorPicker',
    'search-bar': 'SearchBar',
    map: 'Map',
    'web-view': 'WebView',
};

// ---------------------------------------------------------------------------
// Swift code generation helpers
// ---------------------------------------------------------------------------

function indent(code: string, level: number): string {
    const prefix = '    '.repeat(level);
    return code
        .split('\n')
        .map((line) => (line.trim() === '' ? '' : prefix + line))
        .join('\n');
}

function capitalise(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Build the URL string expression for AsyncImage. Adds `?? ""` only when the
 * image field is optional; non-optional String fields don't need nil coalescing.
 */
function imageUrlExpr(accessor: string, field?: Field | null): string {
    // Handle array image fields (e.g., images: [String]?) — use .first
    if (field && field.type.kind === 'array') {
        return `${accessor}${field.optional ? '?' : ''}.first ?? ""`;
    }
    if (field && field.optional) {
        return `${accessor} ?? ""`;
    }
    return accessor;
}

function camelCase(s: string): string {
    return s
        .replace(/[-_\s]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ''))
        .replace(/^[A-Z]/, (c) => c.toLowerCase());
}

function pascalCase(s: string): string {
    return capitalise(camelCase(s));
}

function viewFileName(screenName: string): string {
    return `${pascalCase(screenName)}View.swift`;
}

/**
 * Extract a short relative path from a full filesystem path for header comments.
 * Looks for common app directory markers and returns from that point onwards.
 */
function relativeSourcePath(fullPath: string): string {
    if (!fullPath || fullPath === 'unknown') return 'unknown';
    // Try common app root markers — order matters: prefer deeper matches first
    const markers = ['/app/', '/src/', '/pages/', '/components/', '/types/', '/lib/', '/utils/', '/hooks/', '/services/', '/api/'];
    for (const marker of markers) {
        const idx = fullPath.lastIndexOf(marker);
        if (idx !== -1) {
            return fullPath.slice(idx + 1); // Skip the leading /
        }
    }
    // Fallback: return the last two path segments (dir/file) for context
    const parts = fullPath.split('/');
    if (parts.length >= 2) {
        return parts.slice(-2).join('/');
    }
    return parts[parts.length - 1] ?? fullPath;
}

// ---------------------------------------------------------------------------
// TypeDefinition → Swift type string
// ---------------------------------------------------------------------------

function typeDefToSwift(td: TypeDefinition): string {
    switch (td.kind) {
        case 'string':
            return 'String';
        case 'number':
            return 'Double';
        case 'boolean':
            return 'Bool';
        case 'date':
            return 'Date';
        case 'array':
            return td.elementType ? `[${typeDefToSwift(td.elementType)}]` : '[Any]';
        case 'object':
            if (td.typeName) return pascalCase(td.typeName);
            return '[String: Any]';
        case 'enum':
            if (td.typeName) return pascalCase(td.typeName);
            return 'String';
        case 'union':
            // If all values are strings, this is a string-like union (e.g. 'asc' | 'desc')
            // — represent as String rather than a custom type that may not exist
            if (td.values && td.values.length > 0 && td.values.every((v) => typeof v === 'string')) {
                return 'String';
            }
            if (td.typeName) return pascalCase(td.typeName);
            return 'Any';
        case 'literal':
            return 'String';
        case 'unknown':
            return 'Any';
        default:
            return 'Any';
    }
}

// ---------------------------------------------------------------------------
// State property wrapper generation
// ---------------------------------------------------------------------------

interface StateBinding {
    wrapper: '@State' | '@Binding' | '@Environment';
    type: string;
    name: string;
    defaultValue?: string;
    environmentKey?: string;
}

/**
 * Resolve state bindings by looking up the actual StatePattern from the model
 * to determine proper Swift types instead of defaulting to `Any`.
 */
function generateStateBindings(screen: Screen, model: SemanticAppModel): StateBinding[] {
    const bindings: StateBinding[] = [];

    if (!screen.stateBindings) return bindings;

    const statePatterns = model.stateManagement ?? [];

    for (const bindingName of screen.stateBindings) {
        const pattern = statePatterns.find((sp) => sp.name === bindingName);
        let swiftType = 'Any';
        let defaultValue = '.init()';

        if (pattern) {
            swiftType = resolveStatePatternType(pattern, bindingName, model);
            defaultValue = defaultValueForType(swiftType);
        } else {
            // Infer type from the binding name heuristics
            swiftType = inferTypeFromName(bindingName);
            defaultValue = defaultValueForType(swiftType);
        }

        // If the default is `.init()` and the type matches an enum entity in the model,
        // use the first enum case value instead (e.g., `.priceAsc` for SortOrder).
        if (defaultValue === '.init()') {
            const enumEntity = (model.entities ?? []).find(
                (e) => pascalCase(e.name) === swiftType &&
                    e.fields.length === 1 &&
                    e.fields[0].name === '__enum' &&
                    e.fields[0].type.kind === 'enum' &&
                    Array.isArray(e.fields[0].type.values) &&
                    e.fields[0].type.values.length > 0,
            );
            if (enumEntity) {
                const firstValue = String(enumEntity.fields[0].type.values![0]);
                // Convert kebab-case value to camelCase Swift enum case name
                const caseName = firstValue
                    .split(/[-_ ]+/)
                    .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
                    .join('');
                defaultValue = `.${caseName}`;
            }
        }

        if (pattern && pattern.type === 'global') {
            // Global state should use @Environment to read from a shared store
            const storeName = `${pascalCase(bindingName.replace(/^[Uu]se/, '').replace(/[Ss]tore$/, ''))}Store`;
            bindings.push({
                wrapper: '@Environment',
                type: swiftType,
                name: camelCase(bindingName),
                defaultValue,
                environmentKey: storeName,
            });
        } else {
            bindings.push({
                wrapper: '@State',
                type: swiftType,
                name: camelCase(bindingName),
                defaultValue,
            });
        }
    }

    return bindings;
}

/**
 * Resolve a StatePattern to a concrete Swift type.
 * Inspects the shape to determine the most appropriate type.
 */
function resolveStatePatternType(pattern: StatePattern, bindingName: string, model?: SemanticAppModel): string {
    const shape = pattern.shape;
    if (!shape) return inferTypeFromName(bindingName);

    // If the shape has fields, look for one matching the binding name
    if (shape.fields && shape.fields.length > 0) {
        // Single-field pattern where the field name matches the pattern name
        const matchingField = shape.fields.find(
            (f) => f.name === bindingName || f.name === pattern.name,
        );
        if (matchingField) {
            const resolved = typeDefToSwift(matchingField.type);
            // If the field type resolved to a generic Any, try name-based inference
            if (resolved === 'Any') return inferTypeFromName(bindingName);
            // If the resolved type is a custom name from an inferred object type,
            // verify it actually exists as an entity in the model. Otherwise it's
            // likely a TS type alias (e.g. SortOrder) that wasn't extracted as an entity.
            if (matchingField.type.inferred && matchingField.type.kind === 'object' && matchingField.type.typeName) {
                const entityNames = (model?.entities ?? []).map((e) => pascalCase(e.name));
                if (!entityNames.includes(resolved)) {
                    return inferTypeFromName(bindingName);
                }
            }
            return resolved;
        }

        // If the shape itself is array-like (has an array field), use that
        const arrayField = shape.fields.find((f) => f.type.kind === 'array');
        if (arrayField) {
            return typeDefToSwift(arrayField.type);
        }
    }

    // Fall back to direct shape conversion
    const directType = typeDefToSwift(shape);
    // If the shape resolved to an unhelpful type, use name-based inference
    if (directType === 'Any' || directType === '[String: Any]') {
        return inferTypeFromName(bindingName);
    }
    return directType;
}

/**
 * Infer a Swift type from the binding/variable name when no StatePattern is found.
 */
function inferTypeFromName(name: string): string {
    const lower = name.toLowerCase();
    if (lower.startsWith('is') || lower.startsWith('has') || lower.startsWith('show') || lower.startsWith('should')) return 'Bool';
    if (lower.includes('count') || lower.includes('index') || lower.includes('quantity') || lower.includes('total')) return 'Int';
    if (lower.includes('price') || lower.includes('amount') || lower.includes('rate')) return 'Double';
    if (lower.includes('query') || lower.includes('search') || lower.includes('text') || lower.includes('name') || lower.includes('title')) return 'String';
    if (lower.includes('date') || lower.includes('time')) return 'Date';
    if (lower.includes('items') || lower.includes('list') || lower.includes('results') || lower.endsWith('s')) return '[Any]';
    if (lower.includes('selected') || lower.includes('category') || lower.includes('order') || lower.includes('sort')) return 'String';
    return 'Any';
}

function mapTsTypeToSwift(tsType: string): string {
    const map: Record<string, string> = {
        string: 'String',
        number: 'Double',
        boolean: 'Bool',
        Date: 'Date',
        any: 'Any',
        void: 'Void',
    };

    if (map[tsType]) return map[tsType];

    // Array types: T[] or Array<T>
    const arrayMatch = tsType.match(/^(.+)\[\]$/) ?? tsType.match(/^Array<(.+)>$/);
    if (arrayMatch) return `[${mapTsTypeToSwift(arrayMatch[1])}]`;

    // Optional types: T | null, T | undefined
    const optionalMatch = tsType.match(/^(.+)\s*\|\s*(?:null|undefined)$/);
    if (optionalMatch) return `${mapTsTypeToSwift(optionalMatch[1].trim())}?`;

    // Record<K, V>
    const recordMatch = tsType.match(/^Record<(.+),\s*(.+)>$/);
    if (recordMatch) return `[${mapTsTypeToSwift(recordMatch[1])}: ${mapTsTypeToSwift(recordMatch[2])}]`;

    return tsType;
}

function defaultValueForType(swiftType: string): string {
    if (swiftType === 'String') return '""';
    if (swiftType === 'Double' || swiftType === 'Int') return '0';
    if (swiftType === 'Bool') return 'false';
    if (swiftType === 'Any') return '"" as Any';
    if (swiftType.startsWith('[') && swiftType.endsWith(']') && !swiftType.includes(':')) return '[]';
    if (swiftType.startsWith('[') && swiftType.includes(':')) return '[:]';
    if (swiftType.endsWith('?')) return 'nil';
    return '.init()';
}

// ---------------------------------------------------------------------------
// Helper: derive entity name from screen's data requirements
// ---------------------------------------------------------------------------

function deriveEntityName(screen: Screen): string | null {
    const req = screen.dataRequirements?.[0];
    if (!req) return null;
    // Support both the schema shape (source) and loose test shapes (entity)
    const source = req.source ?? (req as any).entity;
    return source ? pascalCase(source) : null;
}

/**
 * Find the Entity object in the model that matches a screen's data requirements.
 * Tries multiple matching strategies: direct name match, source match, component name match.
 */
function resolveEntity(screen: Screen, model: SemanticAppModel): Entity | null {
    const entities = model.entities ?? [];
    if (entities.length === 0) return null;

    // 1. Match by data requirement source
    const entityName = deriveEntityName(screen);
    if (entityName) {
        const match = entities.find((e) => pascalCase(e.name) === entityName);
        if (match) return match;
    }

    // 2. Match by screen name (e.g., "Products" screen -> "Products" entity)
    const screenEntity = entities.find(
        (e) => pascalCase(e.name) === pascalCase(screen.name),
    );
    if (screenEntity) return screenEntity;

    // 3. For detail screens (e.g. "ProductsDetail"), strip suffix and try
    //    singular + plural forms against entity names and their array element types.
    if (screen.name.endsWith('Detail')) {
        const baseName = screen.name.slice(0, -'Detail'.length); // "Products"
        const singular = baseName.endsWith('s') && baseName.length > 1
            ? baseName.slice(0, -1)
            : baseName; // "Product"

        // 3a. Direct match on singular or base name
        const singularMatch = entities.find(
            (e) => pascalCase(e.name) === pascalCase(singular),
        );
        if (singularMatch) return singularMatch;

        const baseMatch = entities.find(
            (e) => pascalCase(e.name) === pascalCase(baseName),
        );
        if (baseMatch) return baseMatch;

        // 3b. Match entities whose array fields reference the singular type
        //     e.g., Products entity has field { type: { kind: 'array', elementType: { typeName: 'product' } } }
        for (const entity of entities) {
            for (const field of entity.fields ?? []) {
                if (
                    field.type.kind === 'array' &&
                    field.type.elementType &&
                    'typeName' in field.type.elementType &&
                    pascalCase((field.type.elementType as any).typeName) === pascalCase(singular)
                ) {
                    return entity;
                }
            }
        }
    }

    // 4. Match by component names referencing entities
    for (const comp of screen.components ?? []) {
        const compMatch = entities.find(
            (e) =>
                pascalCase(e.name) === pascalCase(comp.name) ||
                comp.name.toLowerCase().includes(e.name.toLowerCase()),
        );
        if (compMatch) return compMatch;
    }

    return null;
}

/**
 * For detail screens, resolve the entity representing a single item (not a collection).
 * Falls back to resolveEntity, but prefers singular entities over collection wrappers.
 * When only a collection entity exists (e.g., "Products" with a products[] field),
 * this looks for the element type entity or synthesizes one from screen components.
 */
function resolveDetailEntity(screen: Screen, model: SemanticAppModel): Entity | null {
    const entities = model.entities ?? [];
    if (entities.length === 0) return null;

    // Derive the singular entity name from the screen
    const singularName = inferEntityFromScreen(screen); // e.g., "Product"

    // 1. Prefer a direct match on the singular name (from TS interface entities)
    const singularMatch = entities.find(
        (e) => pascalCase(e.name) === pascalCase(singularName),
    );
    if (singularMatch) return singularMatch;

    // 2. Try resolveEntity — but verify the result is suitable for a detail view
    const resolved = resolveEntity(screen, model);
    if (resolved) {
        const fields = deduplicateFields(resolved.fields ?? []);
        // If the entity has meaningful fields (not just a single array field), use it
        const nonArrayFields = fields.filter((f) => f.type.kind !== 'array');
        if (nonArrayFields.length >= 2) {
            return resolved;
        }

        // The entity is a collection wrapper (e.g., "Products" with only products[]).
        // Check if the array element type references an entity we can find.
        for (const field of fields) {
            if (
                field.type.kind === 'array' &&
                field.type.elementType &&
                'typeName' in field.type.elementType
            ) {
                const elementTypeName = (field.type.elementType as any).typeName as string;
                const elementEntity = entities.find(
                    (e) => pascalCase(e.name) === pascalCase(elementTypeName),
                );
                if (elementEntity) return elementEntity;
            }
        }

        // No element entity found. If the resolved entity is a collection wrapper
        // (only array fields), return null so the generator can use component-based fallback.
        // Returning a collection wrapper for a detail screen produces poor output
        // (e.g., showing "products" array instead of individual product fields).
        const allArray = fields.every((f) => f.type.kind === 'array');
        if (allArray) return null;

        return resolved;
    }

    return null;
}

/**
 * Given an Entity, extract semantically meaningful fields grouped by role.
 */
interface EntityFieldRoles {
    titleField: Field | null;
    subtitleField: Field | null;
    imageField: Field | null;
    priceField: Field | null;
    descriptionField: Field | null;
    quantityField: Field | null;
    booleanFields: Field[];
    otherFields: Field[];
    allFields: Field[];
}

function categorizeEntityFields(entity: Entity): EntityFieldRoles {
    const fields = deduplicateFields(entity.fields ?? []);
    const result: EntityFieldRoles = {
        titleField: null,
        subtitleField: null,
        imageField: null,
        priceField: null,
        descriptionField: null,
        quantityField: null,
        booleanFields: [],
        otherFields: [],
        allFields: fields,
    };

    for (const f of fields) {
        const lower = f.name.toLowerCase();
        if (!result.titleField && (lower.includes('name') || lower.includes('title'))) {
            result.titleField = f;
        } else if (!result.imageField && (lower.includes('image') || lower.includes('avatar') || lower.includes('photo') || lower.includes('thumbnail'))) {
            result.imageField = f;
        } else if (!result.priceField && (lower.includes('price') || lower.includes('cost') || lower.includes('amount'))) {
            result.priceField = f;
        } else if (!result.quantityField && (lower.includes('quantity') || lower.includes('qty') || lower.includes('count'))) {
            result.quantityField = f;
        } else if (!result.descriptionField && (lower.includes('description') || lower.includes('summary') || lower.includes('body') || lower.includes('content'))) {
            result.descriptionField = f;
        } else if (!result.subtitleField && (lower.includes('subtitle') || lower.includes('email') || lower.includes('category') || lower.includes('brand'))) {
            result.subtitleField = f;
        } else if (f.type.kind === 'boolean') {
            result.booleanFields.push(f);
        } else {
            result.otherFields.push(f);
        }
    }

    // If no subtitle yet, use description as subtitle
    if (!result.subtitleField && result.descriptionField) {
        result.subtitleField = result.descriptionField;
        result.descriptionField = null;
    }

    return result;
}

/** Remove duplicate field names, keeping the first occurrence */
function deduplicateFields(fields: Field[]): Field[] {
    const seen = new Set<string>();
    return fields.filter((f) => {
        if (seen.has(f.name)) return false;
        seen.add(f.name);
        return true;
    });
}

// ---------------------------------------------------------------------------
// Determine if the screen needs async data loading
// ---------------------------------------------------------------------------

function needsAsyncLoading(screen: Screen): boolean {
    const reqs = screen.dataRequirements ?? [];
    return reqs.some((r) => r.fetchStrategy === 'api' || r.fetchStrategy === 'context');
}

// ---------------------------------------------------------------------------
// Detail route detection — used for wrapping list rows in NavigationLink
// ---------------------------------------------------------------------------

/**
 * Find a detail route for the given entity/screen.
 * Looks for routes like `/products/:id` that map to a detail screen
 * for the same entity that the list screen is showing.
 */
function findDetailRoute(screen: Screen, model: SemanticAppModel): { routeCaseName: string } | null {
    const routes = model.navigation?.routes ?? [];
    const screens = model.screens ?? [];
    const entityName = deriveEntityName(screen) ?? inferEntityFromScreen(screen);
    const entityLower = entityName.toLowerCase();

    // Look for a route with dynamic params whose screen name relates to this entity
    for (const route of routes) {
        if (route.params.length === 0) continue;

        // Find the screen this route maps to
        const targetScreen = screens.find((s) => s.name === route.screen);
        if (!targetScreen) continue;

        // Check if the route path includes the entity name (e.g., /products/:id)
        const pathLower = route.path.toLowerCase();
        const isRelated =
            pathLower.includes(entityLower) ||
            pathLower.includes(entityLower + 's') ||
            targetScreen.name.toLowerCase().includes(entityLower);

        if (isRelated) {
            const caseName = getDetailRouteCaseName(targetScreen, model);
            if (caseName) return { routeCaseName: caseName };
        }
    }

    // Also check if there's a detail screen by naming convention (e.g., ProductsDetail)
    const detailScreenName = `${screen.name}Detail`;
    const detailScreen = screens.find((s) => s.name === detailScreenName);
    if (detailScreen) {
        const caseName = getDetailRouteCaseName(detailScreen, model);
        if (caseName) return { routeCaseName: caseName };
    }

    return null;
}

/**
 * Get the AppRoute case name for a detail screen.
 * Mirrors the logic in navigation-generator's getRouteCaseName.
 */
function getDetailRouteCaseName(screen: Screen, model: SemanticAppModel): string | null {
    const baseName = camelCase(screen.name);
    const routes = model.navigation?.routes ?? [];
    const hasDynamic = routes.some(
        (r) => r.screen === screen.name && r.params.length > 0,
    );
    const needsId = screen.layout === 'detail' && screen.dataRequirements.length > 0;

    if (hasDynamic || needsId) {
        return baseName.endsWith('Detail') ? baseName : `${baseName}Detail`;
    }
    if (screen.layout === 'detail' || screen.name.endsWith('Detail')) {
        return baseName.endsWith('Detail') ? baseName : `${baseName}Detail`;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Action button generation
// ---------------------------------------------------------------------------

/**
 * Generate meaningful action buttons from the screen's actions array.
 * Filters out generic/inline actions and produces real SwiftUI buttons.
 */
function generateActionButtons(screen: Screen, indentLevel: number): string[] {
    const actions = screen.actions ?? [];
    if (actions.length === 0) return [];

    const lines: string[] = [];
    const meaningfulActions = actions.filter(
        (a) => (a.label ?? '') !== 'inline' || (a.effect?.target ?? '') !== 'inline',
    );

    if (meaningfulActions.length === 0) return [];

    lines.push('');
    lines.push('// Actions');

    for (const action of meaningfulActions) {
        const label = action.label && action.label !== 'inline'
            ? capitalise(action.label)
            : humanizeActionTarget(action.effect?.target ?? action.label ?? 'action');
        const isDestructive = action.destructive;

        const effectType = action.effect?.type;
        const effectTarget = action.effect?.target ?? action.label ?? 'action';

        if (effectType === 'navigate') {
            lines.push(`NavigationLink("${label}") {`);
            lines.push(`    ${pascalCase(effectTarget)}View()`);
            lines.push('}');
        } else {
            if (isDestructive) {
                lines.push(`Button("${label}", role: .destructive) {`);
            } else {
                lines.push(`Button("${label}") {`);
            }
            lines.push(`    ${camelCase(effectTarget)}()`);
            lines.push('}');
        }
    }

    return lines.map((l) => indent(l, indentLevel));
}

function humanizeActionTarget(target: string): string {
    // "clearCart" -> "Clear Cart"
    return target
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (c) => c.toUpperCase())
        .trim();
}

// ---------------------------------------------------------------------------
// Layout body generation
// ---------------------------------------------------------------------------

function generateLayoutBody(screen: Screen, model: SemanticAppModel, indentLevel: number): string {
    const layout = screen.layout ?? 'detail';
    const components = screen.components ?? [];

    // For screens whose name ends in "Detail" (e.g. "ProductsDetail"),
    // override the layout to 'detail' even if the model says 'custom'.
    // The builder assigns "custom" when it can't determine layout, but
    // the "Detail" suffix is a strong signal.
    if (layout === 'custom' && isDetailScreen(screen, model)) {
        return generateDetailLayout(screen, model, components, indentLevel);
    }

    // Cart screens should use the specialised cart layout regardless of
    // what layout type the builder assigned (often 'list' or 'custom').
    if (isCartScreen(screen) && layout !== 'dashboard' && layout !== 'form') {
        return generateCartLayout(screen, model, components, indentLevel);
    }

    switch (layout) {
        case 'list':
            return generateListLayout(screen, model, components, indentLevel);
        case 'grid':
            return generateGridLayout(screen, model, components, indentLevel);
        case 'form':
            return generateFormLayout(screen, model, components, indentLevel);
        case 'detail':
            return generateDetailLayout(screen, model, components, indentLevel);
        case 'dashboard':
            return generateDashboardLayout(screen, model, components, indentLevel);
        case 'settings':
            return generateSettingsLayout(screen, model, components, indentLevel);
        case 'profile':
            return generateProfileLayout(screen, model, components, indentLevel);
        case 'auth':
            return generateAuthLayout(screen, model, components, indentLevel);
        case 'custom':
            return generateCustomLayout(screen, model, components, indentLevel);
        default:
            return generateCustomLayout(screen, model, components, indentLevel);
    }
}

function generateListLayout(screen: Screen, model: SemanticAppModel, components: ComponentRef[], indentLevel: number): string {
    const entityName = deriveEntityName(screen) ?? inferEntityFromScreen(screen);
    const varName = camelCase(entityName);
    const entity = resolveEntity(screen, model);
    const detailRoute = findDetailRoute(screen, model);
    const lines: string[] = [];

    // If the inferred entity doesn't exist in the model and there are no data requirements,
    // this is likely a static content page — fall back to custom layout
    const allEntities = model.entities ?? [];
    const entityExists = entity || allEntities.some(e => pascalCase(e.name) === pascalCase(entityName));
    if (!entityExists && (screen.dataRequirements ?? []).length === 0) {
        return generateCustomLayout(screen, model, components, indentLevel);
    }

    lines.push('List {');
    lines.push(`    ForEach(${varName}s) { (${varName}: ${entityName}) in`);

    // Wrap row content in NavigationLink when a detail route exists
    if (detailRoute) {
        lines.push(`        NavigationLink(value: AppRoute.${detailRoute.routeCaseName}(id: ${varName}.id)) {`);
    }

    // Extra indentation when wrapped in NavigationLink
    const ri = detailRoute ? '    ' : '';

    if (entity) {
        const roles = categorizeEntityFields(entity);
        lines.push(`        ${ri}HStack(spacing: 12) {`);
        if (roles.imageField) {
            lines.push(`            ${ri}AsyncImage(url: URL(string: ${imageUrlExpr(`${varName}.${camelCase(roles.imageField.name)}`, roles.imageField)})) { image in`);
            lines.push(`                ${ri}image.resizable().aspectRatio(contentMode: .fill)`);
            lines.push(`            ${ri}} placeholder: {`);
            lines.push(`                ${ri}Image(systemName: "photo.circle.fill")`);
            lines.push(`                    ${ri}.foregroundStyle(.secondary)`);
            lines.push(`            ${ri}}`);
            lines.push(`            ${ri}.frame(width: 44, height: 44)`);
            lines.push(`            ${ri}.clipShape(RoundedRectangle(cornerRadius: 8))`);
        }
        lines.push(`            ${ri}VStack(alignment: .leading, spacing: 4) {`);
        if (roles.titleField) {
            lines.push(`                ${ri}Text(${varName}.${camelCase(roles.titleField.name)})`);
            lines.push(`                    ${ri}.font(.headline)`);
        } else {
            lines.push(`                ${ri}Text(String(describing: ${varName}.id))`);
            lines.push(`                    ${ri}.font(.headline)`);
        }
        if (roles.subtitleField) {
            lines.push(`                ${ri}Text(${varName}.${camelCase(roles.subtitleField.name)})`);
            lines.push(`                    ${ri}.font(.subheadline)`);
            lines.push(`                    ${ri}.foregroundStyle(.secondary)`);
        }
        if (roles.priceField) {
            lines.push(`                ${ri}Text(${varName}.${camelCase(roles.priceField.name)}, format: .currency(code: "USD"))`);
            lines.push(`                    ${ri}.font(.subheadline)`);
            lines.push(`                    ${ri}.fontWeight(.semibold)`);
        }
        lines.push(`            ${ri}}`);
        lines.push(`            ${ri}Spacer()`);
        lines.push(`        ${ri}}`);
    } else {
        lines.push(`        ${ri}${entityName}RowView(${varName}: ${varName})`);
    }

    // Close NavigationLink if present
    if (detailRoute) {
        lines.push('        }');
    }

    lines.push('    }');
    lines.push('}');

    // Search support if screen has a search-related state binding
    const hasSearch = (screen.stateBindings ?? []).some(
        (b) => b.toLowerCase().includes('search') || b.toLowerCase().includes('query'),
    );
    if (hasSearch) {
        lines.push('.searchable(text: $searchQuery)');
    }

    // Pull-to-refresh for list views
    lines.push('.refreshable { await loadData() }');

    lines.push(`.navigationTitle("${screen.name}")`);

    // Toolbar with sort/filter when screen has sort/filter state bindings
    const stateBindings = screen.stateBindings ?? [];
    const hasSortOrFilter = stateBindings.some(
        (b) => b.toLowerCase().includes('sortorder') || b.toLowerCase().includes('selectedcategory') || b.toLowerCase().includes('searchquery')
            || b.toLowerCase().includes('sort') || b.toLowerCase().includes('category') || b.toLowerCase().includes('query'),
    );
    if (hasSortOrFilter) {
        // Find the actual sort/filter state binding name
        const sortBinding = stateBindings.find(b =>
            b.toLowerCase().includes('sort') || b.toLowerCase().includes('order'),
        );
        const filterBinding = stateBindings.find(b =>
            b.toLowerCase().includes('category') || b.toLowerCase().includes('filter') || b.toLowerCase().includes('tag'),
        );
        const pickerBinding = sortBinding ? camelCase(sortBinding) : (filterBinding ? camelCase(filterBinding) : 'sortOrder');

        lines.push('.toolbar {');
        lines.push('    ToolbarItem(placement: .automatic) {');
        lines.push('        Menu {');
        lines.push(`            Picker("Sort", selection: $${pickerBinding}) {`);
        lines.push('                Text("Name").tag("name")');
        lines.push('                Text("Price: Low to High").tag("price-asc")');
        lines.push('                Text("Price: High to Low").tag("price-desc")');
        lines.push('                Text("Rating").tag("rating")');
        lines.push('            }');
        lines.push('        } label: {');
        lines.push('            Image(systemName: "line.3.horizontal.decrease.circle")');
        lines.push('        }');
        lines.push('    }');
        lines.push('}');
    }

    return indent(lines.join('\n'), indentLevel);
}

function generateGridLayout(screen: Screen, model: SemanticAppModel, components: ComponentRef[], indentLevel: number): string {
    const entityName = deriveEntityName(screen) ?? inferEntityFromScreen(screen);
    const varName = camelCase(entityName);
    const entity = resolveEntity(screen, model);
    const detailRoute = findDetailRoute(screen, model);
    const lines: string[] = [];

    lines.push('let columns = [');
    lines.push('    GridItem(.adaptive(minimum: 160), spacing: 16)');
    lines.push(']');
    lines.push('');
    lines.push('ScrollView {');
    lines.push('    LazyVGrid(columns: columns, spacing: 16) {');
    lines.push(`        ForEach(${varName}s) { (${varName}: ${entityName}) in`);

    // Wrap grid item in NavigationLink when a detail route exists
    if (detailRoute) {
        lines.push(`            NavigationLink(value: AppRoute.${detailRoute.routeCaseName}(id: ${varName}.id)) {`);
    }

    const gi = detailRoute ? '    ' : '';

    if (entity) {
        const roles = categorizeEntityFields(entity);
        lines.push(`            ${gi}VStack(alignment: .leading, spacing: 8) {`);
        if (roles.imageField) {
            lines.push(`                ${gi}AsyncImage(url: URL(string: ${imageUrlExpr(`${varName}.${camelCase(roles.imageField.name)}`, roles.imageField)})) { image in`);
            lines.push(`                    ${gi}image.resizable().aspectRatio(contentMode: .fill)`);
            lines.push(`                ${gi}} placeholder: {`);
            lines.push(`                    ${gi}Color.gray.opacity(0.2)`);
            lines.push(`                ${gi}}`);
            lines.push(`                ${gi}.frame(height: 120)`);
            lines.push(`                ${gi}.clipped()`);
        }
        if (roles.titleField) {
            lines.push(`                ${gi}Text(${varName}.${camelCase(roles.titleField.name)})`);
            lines.push(`                    ${gi}.font(.headline)`);
            lines.push(`                    ${gi}.lineLimit(2)`);
        }
        if (roles.priceField) {
            lines.push(`                ${gi}Text(${varName}.${camelCase(roles.priceField.name)}, format: .currency(code: "USD"))`);
            lines.push(`                    ${gi}.font(.subheadline)`);
            lines.push(`                    ${gi}.fontWeight(.semibold)`);
        }
        lines.push(`            ${gi}}`);
        lines.push(`            ${gi}.background(Color.clear)`);
        lines.push(`            ${gi}.clipShape(RoundedRectangle(cornerRadius: 12))`);
        lines.push(`            ${gi}.shadow(color: .black.opacity(0.1), radius: 4, y: 2)`);
    } else {
        lines.push(`            ${gi}${entityName}CardView(${varName}: ${varName})`);
    }

    // Close NavigationLink if present
    if (detailRoute) {
        lines.push('            }');
    }

    lines.push('        }');
    lines.push('    }');
    lines.push('    .padding()');
    lines.push('}');

    lines.push(`.navigationTitle("${screen.name}")`);

    return indent(lines.join('\n'), indentLevel);
}

function generateFormLayout(screen: Screen, model: SemanticAppModel, components: ComponentRef[], indentLevel: number): string {
    const entity = resolveEntity(screen, model);
    const lines: string[] = [];

    lines.push('Form {');

    if (entity) {
        const fields = deduplicateFields(entity.fields ?? []);
        // Group fields into sections heuristically
        const sections = groupFieldsIntoSections(fields, screen.name);

        for (const section of sections) {
            lines.push(`    Section("${section.title}") {`);
            for (const field of section.fields) {
                lines.push(`        ${generateFormField(field)}`);
            }
            lines.push('    }');
        }
    } else if (components.length > 0) {
        let currentSection: string | null = null;
        for (const comp of components) {
            const section = (comp as any).section;
            if (section && section !== currentSection) {
                if (currentSection !== null) {
                    lines.push('    }');
                }
                lines.push(`    Section("${section}") {`);
                currentSection = section;
            }
            lines.push(`        ${generateFormComponent(comp)}`);
        }
        if (currentSection !== null) {
            lines.push('    }');
        }
    } else {
        // No entity, no components: generate from screen purpose/description
        lines.push(`    Section("${screen.name} Details") {`);
        lines.push('        TextField("Name", text: $name)');
        lines.push('        TextField("Description", text: $description, axis: .vertical)');
        lines.push('            .lineLimit(3...6)');
        lines.push('    }');
    }

    // Add action buttons section
    const actions = (screen.actions ?? []).filter(
        (a) => a.trigger === 'submit' || (a.label ?? '').toLowerCase().includes('submit') || (a.label ?? '').toLowerCase().includes('save'),
    );
    if (actions.length > 0) {
        lines.push('    Section {');
        for (const action of actions) {
            const label = (action.label && action.label !== 'inline') ? capitalise(action.label) : 'Submit';
            const target = action.effect?.target ?? action.label ?? 'submit';
            lines.push(`        Button("${label}") {`);
            lines.push(`            ${camelCase(target)}()`);
            lines.push('        }');
        }
        lines.push('    }');
    }

    lines.push('}');
    lines.push(`.navigationTitle("${screen.name}")`);

    return indent(lines.join('\n'), indentLevel);
}

function generateDetailLayout(screen: Screen, model: SemanticAppModel, components: ComponentRef[], indentLevel: number): string {
    // For detail screens, use resolveDetailEntity to get the singular item entity
    // (not a collection wrapper) so we render individual fields like name, price, etc.
    const entity = resolveDetailEntity(screen, model);
    // Use the same entity resolution as the state declaration in generateViewFile
    // to ensure the variable name matches what was declared as @State
    const allEntities = (model.entities ?? []).filter(e => !(e.fields.length === 1 && e.fields[0]?.name === '__enum'));
    const inferredName = inferEntityFromScreen(screen);
    const inferredExists = allEntities.some(e => pascalCase(e.name) === pascalCase(inferredName));
    let resolvedEntity = entity;
    if (!inferredExists) {
        // Same fallback logic as generateViewFile
        let matched = entity;
        if (matched) {
            const bestEntity = [...allEntities].sort((a, b) => (b.fields?.length ?? 0) - (a.fields?.length ?? 0))[0];
            if (bestEntity && bestEntity.name !== matched.name && (bestEntity.fields?.length ?? 0) > (matched.fields?.length ?? 0) * 1.5) {
                matched = bestEntity;
            }
        } else if (allEntities.length > 0) {
            matched = [...allEntities].sort((a, b) => (b.fields?.length ?? 0) - (a.fields?.length ?? 0))[0];
        }
        resolvedEntity = matched || entity;
    }
    const entityName = resolvedEntity ? resolvedEntity.name : inferredName;
    const varName = camelCase(entityName);
    const lines: string[] = [];

    lines.push('ScrollView {');
    lines.push('    VStack(alignment: .leading, spacing: 16) {');

    // Use resolvedEntity (which may differ from entity when fallback picked a better match)
    const effectiveEntity = resolvedEntity ?? entity;
    if (effectiveEntity) {
        const roles = categorizeEntityFields(effectiveEntity);

        // Hero image
        if (roles.imageField) {
            lines.push(`        AsyncImage(url: URL(string: ${imageUrlExpr(`${varName}.${camelCase(roles.imageField.name)}`, roles.imageField)})) { image in`);
            lines.push('            image.resizable().aspectRatio(contentMode: .fit)');
            lines.push('        } placeholder: {');
            lines.push('            Rectangle()');
            lines.push('                .fill(Color.gray.opacity(0.2))');
            lines.push('                .frame(height: 250)');
            lines.push('        }');
            lines.push('        .frame(maxWidth: .infinity)');
            lines.push('        .frame(height: 250)');
            lines.push('        .clipped()');
            lines.push('');
        }

        // Title section
        if (roles.titleField) {
            lines.push(`        Text(${varName}.${camelCase(roles.titleField.name)})`);
            lines.push('            .font(.title)');
            lines.push('            .fontWeight(.bold)');
            lines.push('');
        }

        // Subtitle / category
        if (roles.subtitleField) {
            lines.push(`        Text(${varName}.${camelCase(roles.subtitleField.name)})`);
            lines.push('            .font(.subheadline)');
            lines.push('            .foregroundStyle(.secondary)');
            lines.push('');
        }

        // Price
        if (roles.priceField) {
            lines.push(`        Text(${varName}.${camelCase(roles.priceField.name)}, format: .currency(code: "USD"))`);
            lines.push('            .font(.title2)');
            lines.push('            .fontWeight(.semibold)');
            lines.push('');
        }

        // Description
        if (roles.descriptionField) {
            lines.push('        Divider()');
            lines.push('');
            lines.push(`        Text(${varName}.${camelCase(roles.descriptionField.name)})`);
            lines.push('            .font(.body)');
            lines.push('');
        }

        // Remaining fields as a labeled section
        const displayedNames = new Set(
            [roles.titleField, roles.subtitleField, roles.imageField, roles.priceField, roles.descriptionField]
                .filter(Boolean)
                .map((f) => f!.name),
        );
        const remainingFields = roles.allFields.filter(
            (f) => !displayedNames.has(f.name) && f.name !== 'id',
        );
        if (remainingFields.length > 0) {
            lines.push('        Divider()');
            lines.push('');
            lines.push('        VStack(alignment: .leading, spacing: 12) {');
            lines.push('            Text("Details")');
            lines.push('                .font(.headline)');
            for (const field of remainingFields) {
                const fieldLabel = humanizeFieldName(field.name);
                lines.push(`            LabeledContent("${fieldLabel}") {`);
                lines.push(`                Text(String(describing: ${varName}.${camelCase(field.name)}))`);
                lines.push('            }');
            }
            lines.push('        }');
        }
    } else if (components.length > 0) {
        // Fall back to rendering semantic components
        for (const comp of components) {
            lines.push(`        ${generateSemanticComponent(comp, screen)}`);
        }
    } else {
        // Minimal placeholder based on screen purpose
        if (screen.purpose) {
            lines.push(`        // ${screen.purpose}`);
        }
        lines.push(`        Text("${screen.name}")`);
        lines.push('            .font(.title)');
        lines.push('            .fontWeight(.bold)');
        if (screen.description) {
            lines.push('');
            lines.push(`        Text("${screen.description}")`);
            lines.push('            .font(.body)');
            lines.push('            .foregroundStyle(.secondary)');
        }
    }

    // Action buttons
    const actionLines = generateActionButtons(screen, 2);
    if (actionLines.length > 0) {
        lines.push('');
        for (const line of actionLines) {
            lines.push(line);
        }
    }

    lines.push('    }');
    lines.push('    .padding()');
    lines.push('}');

    // For detail views, use the entity title field as dynamic nav title if available
    if (effectiveEntity) {
        const roles = categorizeEntityFields(effectiveEntity);
        if (roles.titleField) {
            lines.push(`.navigationTitle(${varName}.${camelCase(roles.titleField.name)})`);
        } else {
            lines.push(`.navigationTitle("${inferEntityFromScreen(screen)} Detail")`);
        }
    } else {
        const cleanName = screen.name.replace(/Detail$/, '');
        lines.push(`.navigationTitle("${cleanName}")`);
    }

    // Add "Add to Cart" bottom button for detail views with cart-related actions
    const screenActions = screen.actions ?? [];
    const hasCartAction = screenActions.some(
        (a) => (a.label ?? '').toLowerCase().includes('cart')
            || (a.effect?.target ?? '').toLowerCase().includes('cart')
            || (a.label ?? '').toLowerCase().includes('add to cart')
            || (a.effect?.type === 'mutate' && (a.effect?.target ?? '').toLowerCase().includes('cart')),
    );
    if (hasCartAction) {
        lines.push('.safeAreaInset(edge: .bottom) {');
        lines.push('    Button {');
        lines.push('        addToCart()');
        lines.push('    } label: {');
        lines.push('        Label("Add to Cart", systemImage: "cart.badge.plus")');
        lines.push('            .font(.headline)');
        lines.push('            .frame(maxWidth: .infinity)');
        lines.push('    }');
        lines.push('    .buttonStyle(.borderedProminent)');
        lines.push('    .controlSize(.large)');
        lines.push('    .padding()');
        lines.push('}');
    }

    return indent(lines.join('\n'), indentLevel);
}

function generateDashboardLayout(screen: Screen, model: SemanticAppModel, components: ComponentRef[], indentLevel: number): string {
    // For dashboard/home screens, resolveEntity may return a bogus "Home" entity
    // that doesn't match any real data model. Fall back to the first non-enum entity.
    let entity = resolveEntity(screen, model);
    let entityName = deriveEntityName(screen) ?? inferEntityFromScreen(screen);

    // If resolveEntity returned null or matched an entity with very few fields (< 3),
    // fall back to the entity in the model with the most fields (e.g., "Product" for e-commerce).
    const entities = model.entities ?? [];
    if (entities.length > 0 && (!entity || (entity.fields ?? []).length < 3)) {
        const bestEntity = [...entities].sort((a, b) => (b.fields ?? []).length - (a.fields ?? []).length)[0];
        if (bestEntity && (bestEntity.fields ?? []).length >= 3) {
            entity = bestEntity;
            entityName = pascalCase(bestEntity.name);
        }
    }

    // Ensure entityName aligns with the resolved entity. For dashboard/home screens,
    // entityName may still be "Home" from inferEntityFromScreen while entity was resolved
    // to a real data entity (e.g. Product) via component name matching.
    if (entity && pascalCase(entity.name) !== entityName) {
        entityName = pascalCase(entity.name);
    }

    const varName = camelCase(entityName);
    const dataReqs = screen.dataRequirements ?? [];
    const actions = screen.actions ?? [];
    const otherScreens = (model.screens ?? []).filter((s) => s.name !== screen.name);
    const lines: string[] = [];

    lines.push('ScrollView {');
    lines.push('    VStack(spacing: 24) {');

    // Hero / welcome section
    lines.push('        // Hero section');
    lines.push('        VStack(spacing: 8) {');
    lines.push('            Text("Welcome")');
    lines.push('                .font(.largeTitle)');
    lines.push('                .fontWeight(.bold)');
    // Use a short, user-friendly subtitle — never dump raw screen.purpose or
    // verbose AI-generated descriptions into the UI.
    const rawDesc = screen.description ?? '';
    const isGenericDesc = rawDesc === `Screen for ${screen.name}` || rawDesc.length === 0;
    const isVerboseDesc = rawDesc.length > 60; // Likely an internal purpose string, not UI text
    if (!isGenericDesc && !isVerboseDesc) {
        lines.push(`            Text("${rawDesc}")`);
    } else if (entity) {
        lines.push('            Text("Discover amazing products")');
    } else {
        lines.push('            Text("Here\\u{2019}s what\\u{2019}s happening today")');
    }
    lines.push('                .font(.subheadline)');
    lines.push('                .foregroundStyle(.secondary)');
    lines.push('        }');
    lines.push('        .frame(maxWidth: .infinity)');
    lines.push('        .padding(.top)');

    // Featured items horizontal scroll (when there's a collection data requirement)
    const collectionReq = dataReqs.find((r) => r.cardinality === 'many');
    if (collectionReq || entity) {
        // Always use the (possibly fallback-corrected) varName so the variable reference
        // matches the @State property declared in generateViewFile.
        const featuredArrayVar = varName.endsWith('s') ? varName : `${varName}s`;

        lines.push('');
        lines.push(`        // Featured ${entityName.toLowerCase()}s`);
        lines.push(`        if !${featuredArrayVar}.isEmpty {`);
        lines.push('            VStack(alignment: .leading, spacing: 12) {');
        lines.push('                Text("Featured")');
        lines.push('                    .font(.title2)');
        lines.push('                    .fontWeight(.bold)');
        lines.push('');
        lines.push('                ScrollView(.horizontal, showsIndicators: false) {');
        lines.push('                    LazyHStack(spacing: 16) {');
        lines.push(`                        ForEach(${featuredArrayVar}) { (${varName}: ${entityName}) in`);

        if (entity) {
            const roles = categorizeEntityFields(entity);
            lines.push('                            VStack(alignment: .leading, spacing: 8) {');
            if (roles.imageField) {
                lines.push(`                                AsyncImage(url: URL(string: ${imageUrlExpr(`${varName}.${camelCase(roles.imageField.name)}`, roles.imageField)})) { image in`);
                lines.push('                                    image.resizable().aspectRatio(contentMode: .fill)');
                lines.push('                                } placeholder: {');
                lines.push('                                    RoundedRectangle(cornerRadius: 12)');
                lines.push('                                        .fill(Color.gray.opacity(0.2))');
                lines.push('                                }');
                lines.push('                                .frame(width: 200, height: 140)');
                lines.push('                                .clipShape(RoundedRectangle(cornerRadius: 12))');
            } else {
                lines.push('                                RoundedRectangle(cornerRadius: 12)');
                lines.push('                                    .fill(Color.accentColor.opacity(0.15))');
                lines.push('                                    .frame(width: 200, height: 140)');
                lines.push('                                    .overlay {');
                lines.push('                                        Image(systemName: "star.fill")');
                lines.push('                                            .font(.largeTitle)');
                lines.push('                                            .tint(.accentColor)');
                lines.push('                                    }');
            }
            if (roles.titleField) {
                lines.push(`                                Text(${varName}.${camelCase(roles.titleField.name)})`);
                lines.push('                                    .font(.headline)');
                lines.push('                                    .lineLimit(1)');
            }
            if (roles.priceField) {
                lines.push(`                                Text(${varName}.${camelCase(roles.priceField.name)}, format: .currency(code: "USD"))`);
                lines.push('                                    .font(.subheadline)');
                lines.push('                                    .fontWeight(.semibold)');
                lines.push('                                    .tint(.accentColor)');
            } else if (roles.subtitleField) {
                lines.push(`                                Text(${varName}.${camelCase(roles.subtitleField.name)})`);
                lines.push('                                    .font(.subheadline)');
                lines.push('                                    .foregroundStyle(.secondary)');
            }
            lines.push('                            }');
            lines.push('                            .frame(width: 200)');
        } else {
            lines.push('                            VStack(alignment: .leading) {');
            lines.push('                                RoundedRectangle(cornerRadius: 12)');
            lines.push('                                    .fill(Color.accentColor.opacity(0.15))');
            lines.push('                                    .frame(width: 200, height: 140)');
            lines.push(`                                Text(${varName}.name)`);
            lines.push('                                    .font(.headline)');
            lines.push('                            }');
            lines.push('                            .frame(width: 200)');
        }

        lines.push('                        }');
        lines.push('                    }');
        lines.push('                    .padding(.horizontal, 1)');
        lines.push('                }');
        lines.push('            }');
        lines.push('        }');
    }

    // Quick action buttons
    const meaningfulActions = actions.filter(
        (a) => (a.label ?? '') !== 'inline' || (a.effect?.target ?? '') !== 'inline',
    );
    if (meaningfulActions.length > 0) {
        lines.push('');
        lines.push('        // Quick actions');
        lines.push('        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 12) {');
        for (const action of meaningfulActions) {
            const label = action.label && action.label !== 'inline'
                ? capitalise(action.label)
                : humanizeActionTarget(action.effect?.target ?? action.label ?? 'action');
            const effectType = action.effect?.type;
            const effectTarget = action.effect?.target ?? action.label ?? 'action';

            if (effectType === 'navigate') {
                lines.push('            NavigationLink {');
                lines.push(`                ${pascalCase(effectTarget)}View()`);
                lines.push('            } label: {');
                lines.push(`                Label("${label}", systemImage: "arrow.right.circle.fill")`);
                lines.push('                    .frame(maxWidth: .infinity, minHeight: 60)');
                lines.push('                    .background(Color.accentColor.opacity(0.1))');
                lines.push('                    .clipShape(RoundedRectangle(cornerRadius: 12))');
                lines.push('            }');
            } else {
                lines.push('            Button {');
                lines.push(`                ${camelCase(effectTarget)}()`);
                lines.push('            } label: {');
                lines.push(`                Label("${label}", systemImage: "bolt.fill")`);
                lines.push('                    .frame(maxWidth: .infinity, minHeight: 60)');
                lines.push('                    .background(Color.accentColor.opacity(0.1))');
                lines.push('                    .clipShape(RoundedRectangle(cornerRadius: 12))');
                lines.push('            }');
            }
        }
        lines.push('        }');
    }

    // Recent items section (when entity is available)
    if (entity) {
        const roles = categorizeEntityFields(entity);
        const arrayVar = varName.endsWith('s') ? varName : `${varName}s`;
        lines.push('');
        lines.push(`        // Recent ${entityName.toLowerCase()}s`);
        lines.push(`        if !${arrayVar}.isEmpty {`);
        lines.push('            VStack(alignment: .leading, spacing: 12) {');
        lines.push('                HStack {');
        lines.push('                    Text("Recent")');
        lines.push('                        .font(.title2)');
        lines.push('                        .fontWeight(.bold)');
        lines.push('                    Spacer()');
        lines.push('                    Button("See All") { }');
        lines.push('                        .font(.subheadline)');
        lines.push('                }');
        lines.push('');
        lines.push(`                ForEach(${arrayVar}.prefix(5)) { (${varName}: ${entityName}) in`);
        lines.push('                    HStack(spacing: 12) {');
        if (roles.imageField) {
            lines.push(`                        AsyncImage(url: URL(string: ${imageUrlExpr(`${varName}.${camelCase(roles.imageField.name)}`, roles.imageField)})) { image in`);
            lines.push('                            image.resizable().aspectRatio(contentMode: .fill)');
            lines.push('                        } placeholder: {');
            lines.push('                            Image(systemName: "photo.circle.fill")');
            lines.push('                                .foregroundStyle(.secondary)');
            lines.push('                        }');
            lines.push('                        .frame(width: 44, height: 44)');
            lines.push('                        .clipShape(RoundedRectangle(cornerRadius: 8))');
        }
        lines.push('                        VStack(alignment: .leading, spacing: 2) {');
        if (roles.titleField) {
            lines.push(`                            Text(${varName}.${camelCase(roles.titleField.name)})`);
            lines.push('                                .font(.body)');
        } else {
            lines.push(`                            Text(String(describing: ${varName}.id))`);
            lines.push('                                .font(.body)');
        }
        if (roles.subtitleField) {
            lines.push(`                            Text(${varName}.${camelCase(roles.subtitleField.name)})`);
            lines.push('                                .font(.caption)');
            lines.push('                                .foregroundStyle(.secondary)');
        }
        lines.push('                        }');
        lines.push('                        Spacer()');
        if (roles.priceField) {
            lines.push(`                        Text(${varName}.${camelCase(roles.priceField.name)}, format: .currency(code: "USD"))`);
            lines.push('                            .font(.subheadline)');
            lines.push('                            .fontWeight(.semibold)');
        }
        lines.push('                    }');
        lines.push('                    Divider()');
        lines.push('                }');
        lines.push('            }');
        lines.push('        }');
    }

    // Navigation links to other screens (when no entity or actions available)
    if (!entity && meaningfulActions.length === 0 && otherScreens.length > 0) {
        lines.push('');
        lines.push('        // Browse');
        lines.push('        VStack(alignment: .leading, spacing: 12) {');
        lines.push('            Text("Explore")');
        lines.push('                .font(.title2)');
        lines.push('                .fontWeight(.bold)');
        lines.push('');
        for (const other of otherScreens.slice(0, 6)) {
            const screenLabel = humanizeFieldName(other.name);
            const sfSymbol = inferSfSymbol(other);
            lines.push('            NavigationLink {');
            lines.push(`                ${pascalCase(other.name)}View()`);
            lines.push('            } label: {');
            lines.push('                HStack {');
            lines.push(`                    Image(systemName: "${sfSymbol}")`);
            lines.push('                        .frame(width: 28)');
            lines.push(`                    Text("${screenLabel}")`);
            lines.push('                    Spacer()');
            lines.push('                    Image(systemName: "chevron.right")');
            lines.push('                        .font(.caption)');
            lines.push('                        .foregroundStyle(.tertiary)');
            lines.push('                }');
            lines.push('                .padding(.vertical, 4)');
            lines.push('            }');
        }
        lines.push('        }');
    }

    lines.push('    }');
    lines.push('    .padding()');
    lines.push('}');

    lines.push(`.navigationTitle("${screen.name}")`);

    return indent(lines.join('\n'), indentLevel);
}

/**
 * Infer an SF Symbol name for a screen based on its name/layout.
 */
function inferSfSymbol(screen: Screen): string {
    const lower = screen.name.toLowerCase();
    if (lower.includes('cart') || lower.includes('basket')) return 'cart.fill';
    if (lower.includes('product') || lower.includes('shop') || lower.includes('store')) return 'bag.fill';
    if (lower.includes('profile') || lower.includes('account') || lower.includes('user')) return 'person.fill';
    if (lower.includes('setting')) return 'gearshape.fill';
    if (lower.includes('search') || lower.includes('explore') || lower.includes('discover')) return 'magnifyingglass';
    if (lower.includes('order') || lower.includes('history')) return 'clock.fill';
    if (lower.includes('home') || lower.includes('dashboard')) return 'house.fill';
    if (lower.includes('favorite') || lower.includes('wishlist')) return 'heart.fill';
    if (lower.includes('notification') || lower.includes('alert')) return 'bell.fill';
    if (lower.includes('message') || lower.includes('chat')) return 'bubble.left.fill';
    if (screen.layout === 'list') return 'list.bullet';
    if (screen.layout === 'form') return 'square.and.pencil';
    if (screen.layout === 'detail') return 'doc.text.fill';
    return 'square.grid.2x2.fill';
}

function generateSettingsLayout(screen: Screen, model: SemanticAppModel, components: ComponentRef[], indentLevel: number): string {
    const lines: string[] = [];

    lines.push('Form {');

    // Generate from state bindings
    const bindings = screen.stateBindings ?? [];
    if (bindings.length > 0) {
        lines.push('    Section("Preferences") {');
        for (const binding of bindings) {
            const lower = binding.toLowerCase();
            if (lower.startsWith('is') || lower.startsWith('enable') || lower.startsWith('show')) {
                lines.push(`        Toggle("${humanizeFieldName(binding)}", isOn: $${camelCase(binding)})`);
            } else {
                lines.push(`        LabeledContent("${humanizeFieldName(binding)}") {`);
                lines.push(`            Text(String(describing: ${camelCase(binding)}))`);
                lines.push('        }');
            }
        }
        lines.push('    }');
    } else {
        lines.push('    Section("General") {');
        lines.push('        // Settings will be populated from app configuration');
        lines.push('    }');
    }

    // Action buttons
    const actions = screen.actions ?? [];
    if (actions.length > 0) {
        lines.push('    Section {');
        for (const action of actions) {
            if ((action.label ?? '') !== 'inline') {
                const isDestructive = action.destructive;
                const actionLabel = capitalise(action.label ?? 'Action');
                const target = action.effect?.target ?? action.label ?? 'action';
                if (isDestructive) {
                    lines.push(`        Button("${actionLabel}", role: .destructive) {`);
                } else {
                    lines.push(`        Button("${actionLabel}") {`);
                }
                lines.push(`            ${camelCase(target)}()`);
                lines.push('        }');
            }
        }
        lines.push('    }');
    }

    lines.push('}');
    lines.push(`.navigationTitle("${screen.name}")`);

    return indent(lines.join('\n'), indentLevel);
}

function generateProfileLayout(screen: Screen, model: SemanticAppModel, components: ComponentRef[], indentLevel: number): string {
    const entity = resolveEntity(screen, model);
    const lines: string[] = [];

    lines.push('ScrollView {');
    lines.push('    VStack(spacing: 20) {');

    // Avatar / profile header
    lines.push('        // Profile header');
    if (entity) {
        const roles = categorizeEntityFields(entity);
        if (roles.imageField) {
            lines.push(`        AsyncImage(url: URL(string: ${imageUrlExpr(`profile.${camelCase(roles.imageField.name)}`, roles.imageField)})) { image in`);
            lines.push('            image.resizable().aspectRatio(contentMode: .fill)');
            lines.push('        } placeholder: {');
            lines.push('            Image(systemName: "person.circle.fill")');
            lines.push('                .resizable()');
            lines.push('                .foregroundStyle(.secondary)');
            lines.push('        }');
            lines.push('        .frame(width: 80, height: 80)');
            lines.push('        .clipShape(Circle())');
        } else {
            lines.push('        Image(systemName: "person.circle.fill")');
            lines.push('            .resizable()');
            lines.push('            .frame(width: 80, height: 80)');
            lines.push('            .foregroundStyle(.secondary)');
        }
        if (roles.titleField) {
            lines.push(`        Text(profile.${camelCase(roles.titleField.name)})`);
            lines.push('            .font(.title2)');
            lines.push('            .fontWeight(.bold)');
        }
        if (roles.subtitleField) {
            lines.push(`        Text(profile.${camelCase(roles.subtitleField.name)})`);
            lines.push('            .font(.subheadline)');
            lines.push('            .foregroundStyle(.secondary)');
        }
    } else {
        lines.push('        Image(systemName: "person.circle.fill")');
        lines.push('            .resizable()');
        lines.push('            .frame(width: 80, height: 80)');
        lines.push('            .foregroundStyle(.secondary)');
        lines.push('        Text("User Name")');
        lines.push('            .font(.title2)');
        lines.push('            .fontWeight(.bold)');
    }

    // Action buttons
    const actionLines = generateActionButtons(screen, 2);
    if (actionLines.length > 0) {
        lines.push('');
        for (const line of actionLines) {
            lines.push(line);
        }
    }

    lines.push('    }');
    lines.push('    .padding()');
    lines.push('}');

    lines.push(`.navigationTitle("${screen.name}")`);

    return indent(lines.join('\n'), indentLevel);
}

function generateAuthLayout(screen: Screen, model: SemanticAppModel, components: ComponentRef[], indentLevel: number): string {
    const lines: string[] = [];

    lines.push('VStack(spacing: 24) {');
    lines.push('    Spacer()');
    lines.push('');

    // Logo / branding area
    lines.push('    // Branding');
    lines.push('    Image(systemName: "person.circle.fill")');
    lines.push('        .resizable()');
    lines.push('        .frame(width: 80, height: 80)');
    lines.push('        .tint(.accentColor)');
    lines.push('');
    lines.push(`    Text("${screen.name}")`);
    lines.push('        .font(.title)');
    lines.push('        .fontWeight(.bold)');
    lines.push('');

    // Form fields from state bindings
    const bindings = screen.stateBindings ?? [];
    if (bindings.length > 0) {
        for (const binding of bindings) {
            const lower = binding.toLowerCase();
            if (lower.includes('password')) {
                lines.push(`    SecureField("Password", text: $${camelCase(binding)})`);
                lines.push('        .textFieldStyle(.roundedBorder)');
            } else if (lower.includes('email')) {
                lines.push(`    TextField("Email", text: $${camelCase(binding)})`);
                lines.push('        .textFieldStyle(.roundedBorder)');
                lines.push('        .keyboardType(.emailAddress)');
                lines.push('        .textContentType(.emailAddress)');
                lines.push('        .textInputAutocapitalization(.never)');
            } else {
                lines.push(`    TextField("${humanizeFieldName(binding)}", text: $${camelCase(binding)})`);
                lines.push('        .textFieldStyle(.roundedBorder)');
            }
        }
    } else {
        lines.push('    TextField("Email", text: $email)');
        lines.push('        .textFieldStyle(.roundedBorder)');
        lines.push('        .keyboardType(.emailAddress)');
        lines.push('        .textContentType(.emailAddress)');
        lines.push('        .textInputAutocapitalization(.never)');
        lines.push('');
        lines.push('    SecureField("Password", text: $password)');
        lines.push('        .textFieldStyle(.roundedBorder)');
    }

    lines.push('');

    // Submit button
    const submitAction = (screen.actions ?? []).find(
        (a) => a.trigger === 'submit' || (a.label ?? '').toLowerCase().includes('login') || (a.label ?? '').toLowerCase().includes('sign'),
    );
    const submitLabel = submitAction
        ? ((submitAction.label && submitAction.label !== 'inline') ? capitalise(submitAction.label) : 'Sign In')
        : 'Sign In';
    lines.push(`    Button("${submitLabel}") {`);
    lines.push(`        ${submitAction ? camelCase(submitAction.effect?.target ?? 'signIn') : 'signIn'}()`);
    lines.push('    }');
    lines.push('    .buttonStyle(.borderedProminent)');
    lines.push('    .controlSize(.large)');

    lines.push('');
    lines.push('    Spacer()');
    lines.push('}');
    lines.push('.padding()');

    return indent(lines.join('\n'), indentLevel);
}

/**
 * Detect if a screen represents a shopping cart / basket view.
 */
function isCartScreen(screen: Screen): boolean {
    const lower = screen.name.toLowerCase();
    if (lower.includes('cart') || lower.includes('basket') || lower.includes('bag')) return true;
    const bindings = screen.stateBindings ?? [];
    return bindings.some((b) => b.toLowerCase().includes('cart'));
}

/**
 * Generate a cart/basket view with empty state, item list with quantity controls,
 * order total, and checkout button.
 */
function generateCartLayout(screen: Screen, model: SemanticAppModel, components: ComponentRef[], indentLevel: number): string {
    const entity = resolveEntity(screen, model);
    const entityName = deriveEntityName(screen) ?? 'CartItem';
    const varName = camelCase(entityName);
    const arrayVar = varName.endsWith('s') ? varName : `${varName}s`;
    const actions = screen.actions ?? [];
    const lines: string[] = [];

    // Determine field accessors from the entity if available.
    // If the entity has a relationship field (e.g. `product: Product`), access
    // title/price/image through the relationship: `cartItem.product.name`.
    let nameAccessor = `${varName}.name`;
    let priceAccessor = `${varName}.price`;
    let quantityAccessor = `${varName}.quantity`;
    let imageAccessor: string | null = null;
    let imageField: Field | null = null;

    if (entity) {
        // Determine the "item" entity for the cart — the entity may be a wrapper
        // (e.g. Cart with `items: [CartItem]`), in which case we need the element entity.
        const allEntities = model.entities ?? [];
        const entityNames = new Set(allEntities.map((e) => pascalCase(e.name)));
        let itemEntity: Entity = entity;

        // If the resolved entity has an array field referencing another entity
        // (e.g. Cart.items: [CartItem]), use that element entity as the item entity.
        const arrayField = (entity.fields ?? []).find(
            (f) => f.type.kind === 'array' && f.type.elementType && 'typeName' in f.type.elementType &&
                entityNames.has(pascalCase((f.type.elementType as any).typeName)),
        );
        if (arrayField && arrayField.type.elementType && 'typeName' in arrayField.type.elementType) {
            const elementTypeName = (arrayField.type.elementType as any).typeName as string;
            const elementEntity = allEntities.find((e) => pascalCase(e.name) === pascalCase(elementTypeName));
            if (elementEntity) {
                itemEntity = elementEntity;
            }
        }

        // Check if the item entity has a reference to another entity (object field whose
        // typeName matches a known entity). If so, categorize that referenced entity's
        // fields and access them through the relationship field.
        const refField = (itemEntity.fields ?? []).find(
            (f) => f.type.kind === 'object' && f.type.typeName && entityNames.has(pascalCase(f.type.typeName)),
        );

        if (refField && refField.type.typeName) {
            const refEntity = allEntities.find((e) => pascalCase(e.name) === pascalCase(refField.type.typeName!));
            const refPrefix = `${varName}.${camelCase(refField.name)}`;
            if (refEntity) {
                const refRoles = categorizeEntityFields(refEntity);
                if (refRoles.titleField) nameAccessor = `${refPrefix}.${camelCase(refRoles.titleField.name)}`;
                if (refRoles.priceField) priceAccessor = `${refPrefix}.${camelCase(refRoles.priceField.name)}`;
                if (refRoles.imageField) {
                    imageAccessor = `${refPrefix}.${camelCase(refRoles.imageField.name)}`;
                    imageField = refRoles.imageField;
                }
            } else {
                // Fallback: access common fields through the reference
                nameAccessor = `${refPrefix}.name`;
                priceAccessor = `${refPrefix}.price`;
            }
            // Quantity stays on the cart item itself (use itemEntity, not referenced entity)
            const roles = categorizeEntityFields(itemEntity);
            if (roles.quantityField) quantityAccessor = `${varName}.${camelCase(roles.quantityField.name)}`;
        } else {
            // No reference field — access fields directly on the item entity
            const roles = categorizeEntityFields(itemEntity);
            if (roles.titleField) nameAccessor = `${varName}.${camelCase(roles.titleField.name)}`;
            if (roles.priceField) priceAccessor = `${varName}.${camelCase(roles.priceField.name)}`;
            if (roles.quantityField) quantityAccessor = `${varName}.${camelCase(roles.quantityField.name)}`;
            if (roles.imageField) {
                imageAccessor = `${varName}.${camelCase(roles.imageField.name)}`;
                imageField = roles.imageField;
            }
        }
    }

    // Wrap in Group so modifiers like .navigationTitle can be applied
    lines.push('Group {');

    // Empty state
    lines.push(`if ${arrayVar}.isEmpty {`);
    lines.push('    // Empty cart state');
    lines.push('    VStack(spacing: 20) {');
    lines.push('        Spacer()');
    lines.push('        Image(systemName: "cart")');
    lines.push('            .font(.system(size: 64))');
    lines.push('            .foregroundStyle(.secondary)');
    lines.push('        Text("Your cart is empty")');
    lines.push('            .font(.title2)');
    lines.push('            .fontWeight(.semibold)');
    lines.push('        Text("Browse our collection and add items to get started.")');
    lines.push('            .font(.subheadline)');
    lines.push('            .foregroundStyle(.secondary)');
    lines.push('            .multilineTextAlignment(.center)');

    // Find a browse/products navigation action, or generate a generic one
    const browseAction = actions.find(
        (a) => a.effect?.type === 'navigate' && (a.effect?.target ?? '').toLowerCase().match(/product|shop|browse|home/),
    );
    if (browseAction) {
        const target = browseAction.effect?.target ?? 'Products';
        lines.push(`        NavigationLink("Browse Products") {`);
        lines.push(`            ${pascalCase(target)}View()`);
        lines.push('        }');
        lines.push('        .buttonStyle(.borderedProminent)');
    } else {
        // Find the first non-cart, non-detail route to navigate to
        const screens = model.screens ?? [];
        const browseScreen = screens.find(
            (s) => !isCartScreen(s) && s.layout !== 'detail',
        );
        if (browseScreen) {
            const routeCaseName = camelCase(browseScreen.name);
            lines.push(`        NavigationLink("Start Shopping", value: AppRoute.${routeCaseName})`);
        } else {
            lines.push('        NavigationLink("Start Shopping") { }');
        }
        lines.push('        .buttonStyle(.borderedProminent)');
    }
    lines.push('        Spacer()');
    lines.push('    }');
    lines.push('    .frame(maxWidth: .infinity)');
    lines.push('    .padding()');

    // Cart with items
    lines.push('} else {');
    lines.push('    VStack(spacing: 0) {');
    lines.push('        // Cart items');
    lines.push('        List {');
    lines.push(`            ForEach(${arrayVar}) { (${varName}: ${entityName}) in`);
    lines.push('                HStack(spacing: 12) {');

    // Item image
    if (imageAccessor) {
        lines.push(`                    AsyncImage(url: URL(string: ${imageUrlExpr(imageAccessor, imageField)})) { image in`);
        lines.push('                        image.resizable().aspectRatio(contentMode: .fill)');
        lines.push('                    } placeholder: {');
        lines.push('                        Color.gray.opacity(0.2)');
        lines.push('                    }');
        lines.push('                    .frame(width: 60, height: 60)');
        lines.push('                    .clipShape(RoundedRectangle(cornerRadius: 8))');
    }

    // Item details
    lines.push('                    VStack(alignment: .leading, spacing: 4) {');
    lines.push(`                        Text(${nameAccessor})`);
    lines.push('                            .font(.body)');
    lines.push('                            .lineLimit(2)');
    lines.push(`                        Text(${priceAccessor}, format: .currency(code: "USD"))`);
    lines.push('                            .font(.subheadline)');
    lines.push('                            .foregroundStyle(.secondary)');
    lines.push('                    }');

    // Quantity controls
    lines.push('                    Spacer()');
    lines.push('                    HStack(spacing: 12) {');
    lines.push('                        Button {');
    lines.push(`                            decrementQuantity(for: ${varName})`);
    lines.push('                        } label: {');
    lines.push('                            Image(systemName: "minus.circle")');
    lines.push('                                .font(.title3)');
    lines.push('                        }');
    lines.push(`                        Text("\\(${quantityAccessor})")`);
    lines.push('                            .font(.body)');
    lines.push('                            .monospacedDigit()');
    lines.push('                            .frame(minWidth: 24)');
    lines.push('                        Button {');
    lines.push(`                            incrementQuantity(for: ${varName})`);
    lines.push('                        } label: {');
    lines.push('                            Image(systemName: "plus.circle.fill")');
    lines.push('                                .font(.title3)');
    lines.push('                        }');
    lines.push('                    }');
    lines.push('                    .buttonStyle(.plain)');
    lines.push('                    .tint(.accentColor)');
    lines.push('                }');
    lines.push('                .padding(.vertical, 4)');
    lines.push('                .swipeActions(edge: .trailing, allowsFullSwipe: true) {');
    lines.push(`                    Button(role: .destructive) {`);
    lines.push(`                        if let index = ${arrayVar}.firstIndex(where: { $0.id == ${varName}.id }) {`);
    lines.push(`                            ${arrayVar}.remove(at: index)`);
    lines.push('                        }');
    lines.push('                    } label: {');
    lines.push('                        Label("Delete", systemImage: "trash")');
    lines.push('                    }');
    lines.push('                }');
    lines.push('            }');
    lines.push('        }');
    lines.push('        .listStyle(.plain)');
    lines.push('');

    // Order summary / checkout footer
    lines.push('        // Order summary');
    lines.push('        VStack(spacing: 16) {');
    lines.push('            Divider()');
    lines.push('            HStack {');
    lines.push('                Text("Total")');
    lines.push('                    .font(.headline)');
    lines.push('                Spacer()');
    lines.push('                Text(cartTotal, format: .currency(code: "USD"))');
    lines.push('                    .font(.title3)');
    lines.push('                    .fontWeight(.bold)');
    lines.push('            }');
    lines.push('');

    // Checkout button
    const checkoutAction = actions.find(
        (a) => (a.label ?? '').toLowerCase().includes('checkout') || (a.effect?.target ?? '').toLowerCase().includes('checkout'),
    );
    const checkoutTarget = checkoutAction?.effect?.target ?? 'checkout';
    lines.push(`            Button {`);
    lines.push(`                ${camelCase(checkoutTarget)}()`);
    lines.push('            } label: {');
    lines.push('                Text("Proceed to Checkout")');
    lines.push('                    .font(.headline)');
    lines.push('                    .frame(maxWidth: .infinity)');
    lines.push('            }');
    lines.push('            .buttonStyle(.borderedProminent)');
    lines.push('            .controlSize(.large)');
    lines.push('');

    // Clear cart button
    const clearAction = actions.find(
        (a) => a.destructive || (a.label ?? '').toLowerCase().includes('clear') || (a.effect?.target ?? '').toLowerCase().includes('clear'),
    );
    const clearTarget = clearAction?.effect?.target ?? 'clearCart';
    lines.push(`            Button("Clear Cart", role: .destructive) {`);
    lines.push(`                ${camelCase(clearTarget)}()`);
    lines.push('            }');
    lines.push('            .font(.subheadline)');

    lines.push('        }');
    lines.push('        .padding()');
    lines.push('    }');
    lines.push('}');

    // Close Group wrapper
    lines.push('}');

    lines.push(`.navigationTitle("${screen.name}")`);

    return indent(lines.join('\n'), indentLevel);
}

/**
 * Generate a layout for screens with layout type 'custom'.
 * This is the fallback that needs to be smart enough to produce meaningful views
 * from data requirements, actions, components, and screen metadata.
 */
function generateCustomLayout(screen: Screen, model: SemanticAppModel, components: ComponentRef[], indentLevel: number): string {
    // Detect cart screens and generate specialised cart UI
    if (isCartScreen(screen)) {
        return generateCartLayout(screen, model, components, indentLevel);
    }

    const dataReqs = screen.dataRequirements ?? [];
    const actions = screen.actions ?? [];
    const entity = resolveEntity(screen, model);
    const lines: string[] = [];

    // Determine what kind of content this screen has
    const hasCollectionData = dataReqs.some((r) => r.cardinality === 'many');
    const hasSingleData = dataReqs.some((r) => r.cardinality === 'one');
    const hasComponents = components.length > 0;
    const repeatedComponents = components.filter((c) => c.count === 'repeated');
    const singleComponents = components.filter((c) => c.count === 'single');

    lines.push('ScrollView {');
    lines.push('    VStack(alignment: .leading, spacing: 16) {');

    // Screen purpose as section header
    if (screen.purpose && screen.purpose !== `Renders the ${screen.name} view at route /`) {
        lines.push(`        // ${screen.purpose}`);
    }

    // If we have repeated components or collection data, render a list-like section
    if (repeatedComponents.length > 0 || hasCollectionData) {
        const entityName = deriveEntityName(screen) ?? inferEntityFromScreen(screen);
        const varName = camelCase(entityName);

        if (entity) {
            const roles = categorizeEntityFields(entity);

            lines.push('');
            lines.push(`        // ${entityName} list`);
            lines.push(`        ForEach(${varName}s) { (${varName}: ${entityName}) in`);
            lines.push('            HStack(spacing: 12) {');
            if (roles.imageField) {
                lines.push(`                AsyncImage(url: URL(string: ${imageUrlExpr(`${varName}.${camelCase(roles.imageField.name)}`, roles.imageField)})) { image in`);
                lines.push('                    image.resizable().aspectRatio(contentMode: .fill)');
                lines.push('                } placeholder: {');
                lines.push('                    Color.gray.opacity(0.2)');
                lines.push('                }');
                lines.push('                .frame(width: 60, height: 60)');
                lines.push('                .clipShape(RoundedRectangle(cornerRadius: 8))');
            }
            lines.push('                VStack(alignment: .leading, spacing: 4) {');
            if (roles.titleField) {
                lines.push(`                    Text(${varName}.${camelCase(roles.titleField.name)})`);
                lines.push('                        .font(.headline)');
            }
            if (roles.subtitleField) {
                lines.push(`                    Text(${varName}.${camelCase(roles.subtitleField.name)})`);
                lines.push('                        .font(.subheadline)');
                lines.push('                        .foregroundStyle(.secondary)');
            }
            if (roles.priceField) {
                lines.push(`                    Text(${varName}.${camelCase(roles.priceField.name)}, format: .currency(code: "USD"))`);
                lines.push('                        .font(.subheadline)');
                lines.push('                        .fontWeight(.semibold)');
            }
            lines.push('                }');
            lines.push('                Spacer()');
            lines.push('            }');
            lines.push('            Divider()');
            lines.push('        }');
        } else {
            lines.push('');
            for (const comp of repeatedComponents) {
                lines.push(`        // ${comp.name} list`);
                lines.push(`        ForEach(${camelCase(comp.name)}s) { item in`);
                lines.push(`            ${comp.suggestedSwiftUI ?? comp.name}(item: item)`);
                lines.push('        }');
            }
        }
    }

    // Single components
    if (singleComponents.length > 0 && !hasCollectionData) {
        for (const comp of singleComponents) {
            lines.push(`        ${generateSemanticComponent(comp, screen)}`);
        }
    }

    // If no components and no data, generate from screen description
    if (!hasComponents && !hasCollectionData && !hasSingleData) {
        lines.push(`        Text("${screen.name}")`);
        lines.push('            .font(.largeTitle)');
        lines.push('            .fontWeight(.bold)');

        if (screen.description && screen.description !== `Screen for ${screen.name}`) {
            lines.push('');
            lines.push(`        Text("${screen.description}")`);
            lines.push('            .font(.body)');
            lines.push('            .foregroundStyle(.secondary)');
        }
    }

    // Action buttons
    const meaningfulActions = actions.filter(
        (a) => (a.label ?? '') !== 'inline' || (a.effect?.target ?? '') !== 'inline',
    );
    if (meaningfulActions.length > 0) {
        lines.push('');
        for (const action of meaningfulActions) {
            const effectTarget = action.effect?.target ?? action.label ?? 'action';
            const label = action.label && action.label !== 'inline'
                ? capitalise(action.label)
                : humanizeActionTarget(effectTarget);
            if (action.destructive) {
                lines.push(`        Button("${label}", role: .destructive) {`);
            } else {
                lines.push(`        Button("${label}") {`);
            }
            lines.push(`            ${camelCase(effectTarget)}()`);
            lines.push('        }');
        }
    }

    lines.push('    }');
    lines.push('    .padding()');
    lines.push('}');

    lines.push(`.navigationTitle("${screen.name}")`);

    return indent(lines.join('\n'), indentLevel);
}

// ---------------------------------------------------------------------------
// Component generation
// ---------------------------------------------------------------------------

/**
 * Generate SwiftUI code for a ComponentRef from the semantic model.
 * Unlike the old approach, this doesn't rely on web-specific type names.
 */
function generateSemanticComponent(comp: ComponentRef, screen: Screen): string {
    const name = comp.name;
    const lower = name.toLowerCase();

    // Try to identify what kind of component this is semantically
    if (lower.includes('image') || lower === 'image') {
        return 'AsyncImage(url: imageURL) { image in\n            image.resizable().aspectRatio(contentMode: .fit)\n        } placeholder: {\n            ProgressView()\n        }';
    }
    if (lower.includes('link') || lower.includes('navigation')) {
        return `NavigationLink("View Details") {\n            // Navigate to detail\n        }`;
    }
    if (lower.includes('button') || lower.includes('action')) {
        const label = name.replace(/Button$/i, '').replace(/([A-Z])/g, ' $1').trim();
        return `Button("${label}") {\n            // ${name} action\n            ${camelCase(name)}()\n        }`;
    }
    if (lower.includes('card')) {
        return `${pascalCase(name)}()`; // Assume a sub-view exists
    }
    if (lower.includes('search')) {
        return '// Search handled via .searchable modifier';
    }

    // Default: render as a sub-view reference
    if (comp.suggestedSwiftUI) {
        return `${comp.suggestedSwiftUI}()`;
    }
    return `${pascalCase(name)}()`;
}

function generateComponent(comp: any, entityName?: string): string {
    const type = comp.type ?? comp.name?.toLowerCase() ?? 'text';
    const swiftComp = COMPONENT_MAP[type] ?? null;

    // If this is a known web-style component type, use the original mapping
    if (swiftComp) {
        switch (type) {
            case 'button':
                return `Button("${comp.label ?? 'Action'}") {\n    // Action: ${comp.label ?? 'Action'}\n}`;
            case 'text':
                if (comp.binding) {
                    return `Text(${comp.binding})`;
                }
                return `Text("${comp.content ?? comp.label ?? ''}")${comp.font ? `\n    .font(.${comp.font})` : ''}`;
            case 'image':
                if (comp.url || comp.binding) {
                    return `AsyncImage(url: URL(string: ${comp.binding ?? `"${comp.url}"`})) { image in\n    image.resizable().aspectRatio(contentMode: .fill)\n} placeholder: {\n    ProgressView()\n}`;
                }
                return `Image(systemName: "${comp.systemImage ?? 'photo'}")`;
            case 'text-field':
                return `TextField("${comp.placeholder ?? comp.label ?? ''}", text: $${camelCase(comp.binding ?? 'text')})`;
            case 'secure-field':
                return `SecureField("${comp.placeholder ?? 'Password'}", text: $${camelCase(comp.binding ?? 'password')})`;
            case 'toggle':
                return `Toggle("${comp.label ?? ''}", isOn: $${camelCase(comp.binding ?? 'isOn')})`;
            case 'picker':
                return `Picker("${comp.label ?? ''}", selection: $${camelCase(comp.binding ?? 'selection')}) {\n    // Add picker options here\n}`;
            case 'divider':
                return 'Divider()';
            case 'spacer':
                return 'Spacer()';
            default:
                return `// Component: ${type}`;
        }
    }

    // For semantic component names (e.g. "ProductCard", "AddToCartButton", "Link")
    return `${pascalCase(comp.name ?? type)}()`;
}

function generateFormComponent(comp: any): string {
    const type = comp.type ?? 'text-field';

    switch (type) {
        case 'text-field':
            return `TextField("${comp.placeholder ?? comp.label ?? ''}", text: $${camelCase(comp.binding ?? 'text')})`;
        case 'secure-field':
            return `SecureField("${comp.placeholder ?? 'Password'}", text: $${camelCase(comp.binding ?? 'password')})`;
        case 'toggle':
            return `Toggle("${comp.label ?? ''}", isOn: $${camelCase(comp.binding ?? 'isOn')})`;
        case 'picker':
            return `Picker("${comp.label ?? ''}", selection: $${camelCase(comp.binding ?? 'selection')}) {\n            // Add options here\n        }`;
        case 'date-picker':
            return `DatePicker("${comp.label ?? ''}", selection: $${camelCase(comp.binding ?? 'date')})`;
        case 'slider':
            return `Slider(value: $${camelCase(comp.binding ?? 'value')})`;
        case 'stepper':
            return `Stepper("${comp.label ?? ''}", value: $${camelCase(comp.binding ?? 'value')})`;
        case 'button':
            return `Button("${comp.label ?? 'Submit'}") {\n            // Action: ${comp.label ?? 'Submit'}\n        }`;
        default:
            return generateComponent(comp);
    }
}

/**
 * Generate a form field from an Entity Field definition.
 */
function generateFormField(field: Field): string {
    const label = humanizeFieldName(field.name);
    const binding = camelCase(field.name);

    switch (field.type.kind) {
        case 'string':
            return `TextField("${label}", text: $${binding})`;
        case 'number':
            return `TextField("${label}", value: $${binding}, format: .number)`;
        case 'boolean':
            return `Toggle("${label}", isOn: $${binding})`;
        case 'date':
            return `DatePicker("${label}", selection: $${binding})`;
        case 'enum':
            return `Picker("${label}", selection: $${binding}) {\n            ${(field.type.values ?? []).map((v) => `Text("${v}").tag("${v}")`).join('\n            ')}\n        }`;
        default:
            return `TextField("${label}", text: $${binding})`;
    }
}

/**
 * Group entity fields into form sections for a more structured Form layout.
 */
function groupFieldsIntoSections(fields: Field[], screenName: string): { title: string; fields: Field[] }[] {
    // Filter out id/key fields
    const editableFields = fields.filter((f) => !f.isPrimaryKey && f.name.toLowerCase() !== 'id');

    if (editableFields.length <= 3) {
        return [{ title: `${screenName} Details`, fields: editableFields }];
    }

    // Split into "basic info" and "additional details"
    const basicNames = ['name', 'title', 'email', 'username', 'description', 'summary', 'label'];
    const basic = editableFields.filter((f) => basicNames.some((n) => f.name.toLowerCase().includes(n)));
    const rest = editableFields.filter((f) => !basicNames.some((n) => f.name.toLowerCase().includes(n)));

    const sections: { title: string; fields: Field[] }[] = [];
    if (basic.length > 0) {
        sections.push({ title: 'Basic Information', fields: basic });
    }
    if (rest.length > 0) {
        sections.push({ title: 'Additional Details', fields: rest });
    }
    if (sections.length === 0) {
        sections.push({ title: `${screenName} Details`, fields: editableFields });
    }
    return sections;
}

// ---------------------------------------------------------------------------
// Helper: humanize names
// ---------------------------------------------------------------------------

function humanizeFieldName(name: string): string {
    return name
        .replace(/([A-Z])/g, ' $1')
        .replace(/[-_]+/g, ' ')
        .replace(/^./, (c) => c.toUpperCase())
        .trim();
}

function inferEntityFromScreen(screen: Screen): string {
    // Try to derive an entity name from the screen name
    // e.g., "Products" -> "Product", "Cart" -> "Cart", "Home" -> "Item"
    // For detail screens: "ProductsDetail" -> "Product", "UserDetail" -> "User"
    let name = screen.name;

    // Strip "Detail" suffix first (builder appends it for /products/:id routes)
    if (name.endsWith('Detail')) {
        name = name.slice(0, -'Detail'.length);
    }

    // Singularize: "Products" -> "Product"
    if (name.endsWith('s') && name.length > 1) {
        return pascalCase(name.slice(0, -1));
    }
    return pascalCase(name);
}

/**
 * Check if a screen is a detail view (single-entity display).
 * Detail screens are those with names ending in "Detail" or routes with dynamic params.
 */
function isDetailScreen(screen: Screen, model: SemanticAppModel): boolean {
    if (screen.layout === 'detail') return true;
    if (screen.name.endsWith('Detail')) return true;
    // Check if the screen's route has dynamic params
    const routes = model.navigation?.routes ?? [];
    const matchingRoute = routes.find(
        (r) => r.screen === screen.name && r.params.length > 0,
    );
    return !!matchingRoute;
}

// ---------------------------------------------------------------------------
// Main view generation
// ---------------------------------------------------------------------------

function generateViewFile(screen: Screen, model: SemanticAppModel): GeneratedFile {
    const viewName = `${pascalCase(screen.name)}View`;
    const fileName = viewFileName(screen.name);
    const bindings = generateStateBindings(screen, model);
    const warnings: string[] = [];

    const lines: string[] = [];

    // Header
    lines.push(`// Generated by Morphkit from: ${relativeSourcePath(screen.sourceFile ?? 'unknown')}`);
    lines.push('');
    lines.push('import SwiftUI');
    lines.push('');

    // Struct declaration
    lines.push(`struct ${viewName}: View {`);

    // State properties from stateBindings (resolved via model.stateManagement)
    for (const binding of bindings) {
        if (binding.wrapper === '@Environment') {
            lines.push(`    @Environment(\\${binding.environmentKey ? '.' + binding.environmentKey : '.' + binding.name}) private var ${binding.name}`);
        } else if (binding.wrapper === '@Binding') {
            lines.push(`    ${binding.wrapper} var ${binding.name}: ${binding.type}`);
        } else {
            lines.push(`    ${binding.wrapper} private var ${binding.name}: ${binding.type} = ${binding.defaultValue ?? defaultValueForType(binding.type)}`);
        }
    }

    // Data requirement-driven state properties
    const dataReqs = screen.dataRequirements ?? [];
    const declaredNames = new Set(bindings.map((b) => b.name));
    let hasApiData = false;

    for (const req of dataReqs) {
        const reqSource = req.source ?? (req as any).entity;
        if (!reqSource) continue;
        const entityName = pascalCase(reqSource);
        const varName = camelCase(reqSource);

        if (req.cardinality === 'many' || (req as any).type === 'list') {
            const arrayVarName = varName.endsWith('s') ? varName : `${varName}s`;
            if (!declaredNames.has(arrayVarName)) {
                lines.push(`    @State private var ${arrayVarName}: [${entityName}] = []`);
                declaredNames.add(arrayVarName);
            }
        } else {
            if (!declaredNames.has(varName)) {
                lines.push(`    @State private var ${varName}: ${entityName}?`);
                declaredNames.add(varName);
            }
        }

        if (req.fetchStrategy === 'api' || req.fetchStrategy === 'context') {
            hasApiData = true;
        }
    }

    // Entity-based properties for list/grid/dashboard layouts when no explicit data requirements
    let derivedEntityName = deriveEntityName(screen);
    if (derivedEntityName && (screen.layout === 'list' || screen.layout === 'grid')) {
        const varName = camelCase(derivedEntityName);
        const arrayVarName = varName.endsWith('s') ? varName : `${varName}s`;
        if (!declaredNames.has(arrayVarName)) {
            lines.push(`    @State private var ${arrayVarName}: [${derivedEntityName}] = []`);
            declaredNames.add(arrayVarName);
        }
        // List/grid screens with entity arrays need async data loading
        if (!hasApiData) {
            hasApiData = true;
        }
    }

    // For dashboard layouts, ensure the collection array is declared using the same
    // fallback logic as generateDashboardLayout (prefer primary entity over "Home")
    if (screen.layout === 'dashboard') {
        // For dashboard/home screens, always use the entity with the most fields
        // rather than trying to derive from screen name (which gives "Home" → "Home" type)
        const allEntities = (model.entities ?? []).filter(e => {
            // Skip enum entities (single __enum field)
            if (e.fields.length === 1 && e.fields[0]?.name === '__enum') return false;
            return e.fields.length >= 3;
        });
        const bestEntity = allEntities.sort((a, b) => b.fields.length - a.fields.length)[0];
        const dashEntityName = bestEntity ? pascalCase(bestEntity.name) : (derivedEntityName ?? inferEntityFromScreen(screen));
        const dashVar = camelCase(dashEntityName);
        const dashArrayVar = dashVar.endsWith('s') ? dashVar : `${dashVar}s`;
        if (!declaredNames.has(dashArrayVar)) {
            lines.push(`    @State private var ${dashArrayVar}: [${pascalCase(dashEntityName)}] = []`);
            declaredNames.add(dashArrayVar);
        }
    }

    // Entity-based property for detail layouts
    // Detail screens accept an `id` parameter and load data asynchronously,
    // rather than requiring the full entity to be passed in.
    const letProperties: { name: string; type: string }[] = [];
    let isDetailWithIdLoading = false;
    // Resolved detail entity info — shared across state declaration, body, and loadData
    let resolvedDetailEntityName = '';
    let resolvedDetailVarName = '';
    if (screen.layout === 'detail' || isDetailScreen(screen, model)) {
        // Try to find the actual entity for this detail screen
        const inferredName = inferEntityFromScreen(screen);
        const allEntities = (model.entities ?? []).filter(e => !(e.fields.length === 1 && e.fields[0]?.name === '__enum'));
        let matchedEntity = resolveDetailEntity(screen, model);
        const inferredExists = allEntities.some(e => pascalCase(e.name) === pascalCase(inferredName));
        // If no match found and inferred name doesn't match any entity, fall back to
        // the entity with the most fields (most likely the primary data entity)
        if (!matchedEntity && !inferredExists && allEntities.length > 0) {
            matchedEntity = [...allEntities].sort((a, b) => (b.fields?.length ?? 0) - (a.fields?.length ?? 0))[0];
        }
        // If matched entity doesn't align with the inferred name AND a significantly larger
        // entity exists, prefer the larger one (e.g., prefer Post over Comment for BlogDetail)
        if (matchedEntity && !inferredExists) {
            const bestEntity = [...allEntities].sort((a, b) => (b.fields?.length ?? 0) - (a.fields?.length ?? 0))[0];
            if (bestEntity && bestEntity.name !== matchedEntity.name && (bestEntity.fields?.length ?? 0) > (matchedEntity.fields?.length ?? 0) * 1.5) {
                matchedEntity = bestEntity;
            }
        }
        const eName = matchedEntity ? pascalCase(matchedEntity.name) : pascalCase(inferredName);
        const eVar = matchedEntity ? camelCase(matchedEntity.name) : camelCase(inferredName);
        resolvedDetailEntityName = eName;
        resolvedDetailVarName = eVar;

        // Generate: let id: String
        if (!declaredNames.has('id')) {
            lines.push('    let id: String');
            declaredNames.add('id');
            letProperties.push({ name: 'id', type: 'String' });
        }

        // Generate: @State private var entity: Entity?
        if (!declaredNames.has(eVar)) {
            lines.push(`    @State private var ${eVar}: ${eName}?`);
            declaredNames.add(eVar);
        }

        // Mark that this detail screen needs id-based async loading
        isDetailWithIdLoading = true;
        hasApiData = true; // Ensure isLoading and errorMessage are generated
    }

    // For custom layouts with repeated components, generate array state
    // Skip if this screen is being treated as a detail view
    if ((screen.layout === 'custom' || !screen.layout) && !isDetailScreen(screen, model)) {
        const entity = resolveEntity(screen, model);
        if (entity) {
            const eName = pascalCase(entity.name);
            const eVar = camelCase(entity.name);
            const arrayVarName = eVar.endsWith('s') ? eVar : `${eVar}s`;
            if (!declaredNames.has(arrayVarName)) {
                const repeatedComps = (screen.components ?? []).filter((c) => c.count === 'repeated');
                if (repeatedComps.length > 0) {
                    lines.push(`    @State private var ${arrayVarName}: [${eName}] = []`);
                    declaredNames.add(arrayVarName);
                }
            }
        }
    }

    // Loading state for screens with API data
    // Detail views default to loading=true since they must fetch before displaying
    if (hasApiData || needsAsyncLoading(screen)) {
        if (!declaredNames.has('isLoading')) {
            const loadingDefault = isDetailWithIdLoading ? 'true' : 'false';
            lines.push(`    @State private var isLoading = ${loadingDefault}`);
            declaredNames.add('isLoading');
        }
    }

    // Error state for screens with API data
    if (hasApiData) {
        if (!declaredNames.has('errorMessage')) {
            lines.push('    @State private var errorMessage: String?');
            declaredNames.add('errorMessage');
        }
    }

    // Search state for screens that likely need search
    const hasSearchBinding = (screen.stateBindings ?? []).some(
        (b) => b.toLowerCase().includes('search') || b.toLowerCase().includes('query'),
    );
    if (hasSearchBinding && !declaredNames.has('searchQuery')) {
        lines.push('    @State private var searchQuery: String = ""');
        declaredNames.add('searchQuery');
    }

    // Cart-specific: ensure cart items array state exists and add computed total
    const isCart = isCartScreen(screen);
    if (isCart) {
        const cartEntityName = deriveEntityName(screen) ?? 'CartItem';
        const cartVarName = camelCase(cartEntityName);
        const cartArrayVar = cartVarName.endsWith('s') ? cartVarName : `${cartVarName}s`;
        if (!declaredNames.has(cartArrayVar)) {
            lines.push(`    @State private var ${cartArrayVar}: [${cartEntityName}] = []`);
            declaredNames.add(cartArrayVar);
        }
    }

    if (declaredNames.size > 0) {
        lines.push('');
    }

    // Cart-specific: computed total property
    if (isCart) {
        const cartEntityName = deriveEntityName(screen) ?? 'CartItem';
        const cartVarName = camelCase(cartEntityName);
        const cartArrayVar = cartVarName.endsWith('s') ? cartVarName : `${cartVarName}s`;
        const cartEntity = resolveEntity(screen, model);
        let priceExpr = 'price';
        let qtyField = 'quantity';
        if (cartEntity) {
            // Check for reference field (e.g. product: Product) — access price through it
            const allEntities = model.entities ?? [];
            const entityNamesSet = new Set(allEntities.map((e) => pascalCase(e.name)));

            // Drill through array wrapper (e.g. Cart → CartItem via items: [CartItem])
            let itemEntity: Entity = cartEntity;
            const arrayField = (cartEntity.fields ?? []).find(
                (f) => f.type.kind === 'array' && f.type.elementType && 'typeName' in f.type.elementType &&
                    entityNamesSet.has(pascalCase((f.type.elementType as any).typeName)),
            );
            if (arrayField && arrayField.type.elementType && 'typeName' in arrayField.type.elementType) {
                const elementTypeName = (arrayField.type.elementType as any).typeName as string;
                const elementEntity = allEntities.find((e) => pascalCase(e.name) === pascalCase(elementTypeName));
                if (elementEntity) itemEntity = elementEntity;
            }

            const refField = (itemEntity.fields ?? []).find(
                (f) => f.type.kind === 'object' && f.type.typeName && entityNamesSet.has(pascalCase(f.type.typeName)),
            );
            if (refField && refField.type.typeName) {
                const refEntity = allEntities.find((e) => pascalCase(e.name) === pascalCase(refField.type.typeName!));
                if (refEntity) {
                    const refRoles = categorizeEntityFields(refEntity);
                    if (refRoles.priceField) priceExpr = `${camelCase(refField.name)}.${camelCase(refRoles.priceField.name)}`;
                }
                const roles = categorizeEntityFields(itemEntity);
                if (roles.quantityField) qtyField = camelCase(roles.quantityField.name);
            } else {
                const roles = categorizeEntityFields(itemEntity);
                if (roles.priceField) priceExpr = camelCase(roles.priceField.name);
                if (roles.quantityField) qtyField = camelCase(roles.quantityField.name);
            }
        }
        lines.push(`    private var cartTotal: Double {`);
        lines.push(`        ${cartArrayVar}.reduce(0) { $0 + $1.${priceExpr} * Double($1.${qtyField}) }`);
        lines.push('    }');
        lines.push('');
    }

    // Body
    lines.push('    var body: some View {');

    if (isDetailWithIdLoading) {
        // Detail views: wrap body in Group with if-let for optional entity
        // Reuse the same entity resolution as the state declaration
        const detailEntityName = resolvedDetailEntityName || inferEntityFromScreen(screen);
        const detailVarName = resolvedDetailVarName || camelCase(detailEntityName);

        lines.push(indent('Group {', 2));
        lines.push(indent(`    if let ${detailVarName} {`, 2));
        // Generate the layout body at a deeper indent level (4) since it's inside Group > if let
        lines.push(generateLayoutBody(screen, model, 4));
        lines.push(indent('    } else if isLoading {', 2));
        lines.push(indent('        ProgressView()', 2));
        lines.push(indent('    } else {', 2));
        lines.push(indent('        ContentUnavailableView("Not Found", systemImage: "exclamationmark.triangle")', 2));
        lines.push(indent('    }', 2));
        lines.push(indent('}', 2));
    } else {
        lines.push(generateLayoutBody(screen, model, 2));
    }

    // Add .task modifier for async data loading
    if (hasApiData) {
        lines.push(indent('.task {', 2));
        lines.push(indent('    await loadData()', 2));
        lines.push(indent('}', 2));

        // For non-detail views, add overlay spinner and error alert
        if (!isDetailWithIdLoading) {
            lines.push(indent('.overlay {', 2));
            lines.push(indent('    if isLoading {', 2));
            lines.push(indent('        ProgressView()', 2));
            lines.push(indent('    }', 2));
            lines.push(indent('}', 2));
        }
        lines.push(indent('.alert("Error", isPresented: .constant(errorMessage != nil)) {', 2));
        lines.push(indent('    Button("OK") { errorMessage = nil }', 2));
        lines.push(indent('} message: {', 2));
        lines.push(indent('    if let errorMessage {', 2));
        lines.push(indent('        Text(errorMessage)', 2));
        lines.push(indent('    }', 2));
        lines.push(indent('}', 2));
    }

    lines.push('    }');

    // Generate loadData function for screens with API data requirements
    if (hasApiData) {
        lines.push('');
        lines.push('    // MARK: - Data Loading');
        lines.push('');
        lines.push('    private func loadData() async {');
        lines.push('        isLoading = true');
        lines.push('        defer { isLoading = false }');
        lines.push('');
        lines.push('        do {');

        if (isDetailWithIdLoading) {
            // Reuse the same entity resolution as state declaration and body
            const detailEntityName = resolvedDetailEntityName || inferEntityFromScreen(screen);
            const detailVarName = resolvedDetailVarName || camelCase(detailEntityName);
            // Check if a matching fetch method would exist in the generated API client
            const detailEndpoints = model.apiEndpoints ?? [];
            const hasFetchEndpoint = detailEndpoints.some(ep => {
                const url = ep.url?.toLowerCase() ?? '';
                const nameLower = detailEntityName.toLowerCase();
                return url.includes(nameLower) || url.includes(nameLower + 's');
            });
            if (hasFetchEndpoint) {
                // Find the actual parameter name from the matching endpoint URL
                const matchingEp = detailEndpoints.find(ep => {
                    const url = ep.url?.toLowerCase() ?? '';
                    const nameLower = detailEntityName.toLowerCase();
                    return (url.includes(nameLower) || url.includes(nameLower + 's')) && (url.includes(':') || url.includes('{'));
                });
                const paramMatch = matchingEp?.url?.match(/:([a-zA-Z_]+)/) ?? matchingEp?.url?.match(/\{([a-zA-Z_]+)\}/);
                const paramName = paramMatch ? camelCase(paramMatch[1]) : 'id';
                lines.push(`            ${detailVarName} = try await APIClient.shared.fetch${pascalCase(detailEntityName)}(${paramName}: id)`);
            } else {
                lines.push(`            // Configure fetch${pascalCase(detailEntityName)}(id:) in APIClient`);
                lines.push(`            // ${detailVarName} = try await APIClient.shared.fetch${pascalCase(detailEntityName)}(id: id)`);
            }
        }

        let hasLoadDataBody = isDetailWithIdLoading;
        for (const req of dataReqs) {
            if (req.fetchStrategy === 'api' || req.fetchStrategy === 'context') {
                const reqSource = req.source ?? (req as any).entity;
                if (!reqSource) continue;
                const varName = camelCase(reqSource);
                const arrayVarName = (req.cardinality === 'many' || (req as any).type === 'list')
                    ? (varName.endsWith('s') ? varName : `${varName}s`)
                    : varName;
                // For many/list cardinality, use plural fetch method name
                const fetchName = (req.cardinality === 'many' || (req as any).type === 'list')
                    ? (reqSource.endsWith('s') ? reqSource : `${reqSource}s`)
                    : reqSource;
                lines.push(`            ${arrayVarName} = try await APIClient.shared.fetch${pascalCase(fetchName)}()`);
                hasLoadDataBody = true;
            }
        }

        // For list/grid screens with entity-derived arrays but no explicit API data requirement,
        // generate a fetch call based on the derived entity name.
        if (!hasLoadDataBody && derivedEntityName && (screen.layout === 'list' || screen.layout === 'grid')) {
            const entVar = camelCase(derivedEntityName);
            const entArrayVar = entVar.endsWith('s') ? entVar : `${entVar}s`;
            const pluralName = derivedEntityName.endsWith('s') ? derivedEntityName : `${derivedEntityName}s`;
            // Check if the fetch method would exist in the generated API client
            const listEndpoints = model.apiEndpoints ?? [];
            const hasListFetch = listEndpoints.some(ep => {
                if ((ep.method ?? 'GET') !== 'GET') return false;
                const url = ep.url?.toLowerCase() ?? '';
                if (url.includes(':') || url.includes('{')) return false;
                const lastSeg = url.split('/').filter(s => s).pop() ?? '';
                return lastSeg === entVar + 's' || lastSeg === entVar || lastSeg === pluralName.toLowerCase();
            });
            if (hasListFetch) {
                lines.push(`            ${entArrayVar} = try await APIClient.shared.fetch${pascalCase(pluralName)}()`);
            } else {
                lines.push(`            // Configure fetch${pascalCase(pluralName)}() in APIClient`);
                lines.push(`            // ${entArrayVar} = try await APIClient.shared.fetch${pascalCase(pluralName)}()`);
            }
        }

        lines.push('        } catch {');
        lines.push('            errorMessage = error.localizedDescription');
        lines.push('        }');
        lines.push('    }');
    }

    // Generate action stubs for meaningful actions
    const meaningfulActions = (screen.actions ?? []).filter(
        (a) => (a.label ?? '') !== 'inline' || (a.effect?.target ?? '') !== 'inline',
    );
    if (meaningfulActions.length > 0) {
        lines.push('');
        lines.push('    // MARK: - Actions');

        const generatedFunctions = new Set<string>();
        for (const action of meaningfulActions) {
            const target = action.effect?.target ?? action.label ?? 'action';
            const funcName = camelCase(target);
            if (generatedFunctions.has(funcName)) continue;
            generatedFunctions.add(funcName);

            lines.push('');
            lines.push(`    private func ${funcName}() {`);
            lines.push(`        print("${humanizeActionTarget(target)}")`);
            lines.push('    }');
        }
    }

    // Cart-specific helper functions
    if (isCart) {
        const cartEntityName = deriveEntityName(screen) ?? 'CartItem';
        const cartVarName = camelCase(cartEntityName);
        const cartArrayVar = cartVarName.endsWith('s') ? cartVarName : `${cartVarName}s`;
        let qtyField = 'quantity';
        const cartEntity = resolveEntity(screen, model);
        if (cartEntity) {
            // Drill through array wrapper (e.g. Cart → CartItem)
            const allEntities = model.entities ?? [];
            const entityNamesSet = new Set(allEntities.map((e) => pascalCase(e.name)));
            let itemEntity: Entity = cartEntity;
            const arrayField = (cartEntity.fields ?? []).find(
                (f) => f.type.kind === 'array' && f.type.elementType && 'typeName' in f.type.elementType &&
                    entityNamesSet.has(pascalCase((f.type.elementType as any).typeName)),
            );
            if (arrayField && arrayField.type.elementType && 'typeName' in arrayField.type.elementType) {
                const elementEntity = allEntities.find((e) => pascalCase(e.name) === pascalCase((arrayField.type.elementType as any).typeName));
                if (elementEntity) itemEntity = elementEntity;
            }
            const roles = categorizeEntityFields(itemEntity);
            if (roles.quantityField) qtyField = camelCase(roles.quantityField.name);
        }

        lines.push('');
        lines.push('    // MARK: - Cart Helpers');
        lines.push('');
        lines.push(`    private func incrementQuantity(for item: ${cartEntityName}) {`);
        lines.push(`        guard let index = ${cartArrayVar}.firstIndex(where: { $0.id == item.id }) else { return }`);
        lines.push(`        ${cartArrayVar}[index].${qtyField} += 1`);
        lines.push('    }');
        lines.push('');
        lines.push(`    private func decrementQuantity(for item: ${cartEntityName}) {`);
        lines.push(`        guard let index = ${cartArrayVar}.firstIndex(where: { $0.id == item.id }) else { return }`);
        lines.push(`        if ${cartArrayVar}[index].${qtyField} > 1 {`);
        lines.push(`            ${cartArrayVar}[index].${qtyField} -= 1`);
        lines.push('        } else {');
        lines.push(`            ${cartArrayVar}.remove(at: index)`);
        lines.push('        }');
        lines.push('    }');
        lines.push('');
        lines.push(`    private func removeItems(at offsets: IndexSet) {`);
        lines.push(`        ${cartArrayVar}.remove(atOffsets: offsets)`);
        lines.push('    }');
        lines.push('');
        lines.push('    private func checkout() {');
        lines.push('        print("Checkout initiated")');
        lines.push('    }');
    }

    // Close struct
    lines.push('}');
    lines.push('');

    // Preview
    lines.push(`#Preview {`);
    const hasBindings = bindings.some((b) => b.wrapper === '@Binding');
    if (hasBindings) {
        lines.push(`    @Previewable @State var preview = true`);
    }
    lines.push(`    NavigationStack {`);
    // If the view has required let properties, pass appropriate preview values
    if (letProperties.length > 0) {
        const args = letProperties.map((p) => {
            if (p.type === 'String') return `${p.name}: "preview"`;
            if (p.type === 'Int') return `${p.name}: 0`;
            if (p.type === 'Double') return `${p.name}: 0.0`;
            if (p.type === 'Bool') return `${p.name}: true`;
            return `${p.name}: .preview()`;
        }).join(', ');
        lines.push(`        ${viewName}(${args})`);
    } else {
        lines.push(`        ${viewName}(${hasBindings ? '/* pass bindings */' : ''})`);
    }
    lines.push(`    }`);
    lines.push('}');
    lines.push('');

    // Confidence assessment
    let confidence: 'high' | 'medium' | 'low' = 'high';
    if ((screen.components ?? []).length === 0 && dataReqs.length === 0) {
        confidence = 'medium';
        warnings.push(`No components or data requirements defined for screen "${screen.name}" — generated layout from metadata`);
    }
    if (screen.layout === 'dashboard') {
        confidence = 'medium';
        warnings.push('Dashboard layout generated — review hero section copy and featured item selection');
    }
    if (screen.layout === 'custom') {
        confidence = 'medium';
        warnings.push(`Screen "${screen.name}" uses custom layout — generated best-effort view from components and data requirements`);
    }

    return {
        path: `Views/${fileName}`,
        content: lines.join('\n'),
        sourceMapping: screen.sourceFile ?? 'unknown',
        confidence,
        warnings,
    };
}

// ---------------------------------------------------------------------------
// Row / Card sub-view generation for list/grid screens
// ---------------------------------------------------------------------------

function generateRowView(screen: Screen, model: SemanticAppModel): GeneratedFile | null {
    if (screen.layout !== 'list') return null;

    const entityName = deriveEntityName(screen) ?? inferEntityFromScreen(screen);
    if (!entityName) return null;

    // If we inlined the row content (entity was resolved), skip generating a separate row view
    const entity = resolveEntity(screen, model);
    if (entity) return null;

    // Skip if the inferred entity doesn't exist in the model
    const entities = model.entities ?? [];
    const entityExists = entities.some(e => pascalCase(e.name) === pascalCase(entityName));
    if (!entityExists) return null;

    const varName = camelCase(entityName);
    const lines: string[] = [];

    lines.push(`// Generated by Morphkit from: ${relativeSourcePath(screen.sourceFile ?? 'unknown')}`);
    lines.push('');
    lines.push('import SwiftUI');
    lines.push('');
    lines.push(`struct ${entityName}RowView: View {`);
    lines.push(`    let ${varName}: ${entityName}`);
    lines.push('');
    lines.push('    var body: some View {');
    lines.push('        HStack(spacing: 12) {');
    lines.push(`            Text(String(describing: ${varName}.id))`);
    lines.push('                .font(.headline)');
    lines.push('        }');
    lines.push('    }');
    lines.push('}');
    lines.push('');

    return {
        path: `Views/${entityName}RowView.swift`,
        content: lines.join('\n'),
        sourceMapping: screen.sourceFile ?? 'unknown',
        confidence: 'medium',
        warnings: [`Entity "${entityName}" not found in model — generated minimal row view`],
    };
}

function generateCardView(screen: Screen, model: SemanticAppModel): GeneratedFile | null {
    if (screen.layout !== 'grid' && screen.layout !== 'dashboard') return null;

    const entityName = deriveEntityName(screen) ?? inferEntityFromScreen(screen);
    if (!entityName) return null;

    // If we inlined the card content (entity was resolved), skip generating a separate card view
    const entity = resolveEntity(screen, model);
    if (entity) return null;

    // Skip if the inferred entity doesn't exist in the model — the generated view
    // would reference a non-existent type and fail to compile
    const entities = model.entities ?? [];
    const entityExists = entities.some(e => pascalCase(e.name) === pascalCase(entityName));
    if (!entityExists) return null;

    const varName = camelCase(entityName);
    const lines: string[] = [];

    lines.push(`// Generated by Morphkit from: ${relativeSourcePath(screen.sourceFile ?? 'unknown')}`);
    lines.push('');
    lines.push('import SwiftUI');
    lines.push('');
    lines.push(`struct ${entityName}CardView: View {`);
    lines.push(`    let ${varName}: ${entityName}`);
    lines.push('');
    lines.push('    var body: some View {');
    lines.push('        VStack(alignment: .leading, spacing: 8) {');
    lines.push(`            Text(String(describing: ${varName}.id))`);
    lines.push('                .font(.headline)');
    lines.push('        }');
    lines.push('        .background(Color.clear)');
    lines.push('        .clipShape(RoundedRectangle(cornerRadius: 12))');
    lines.push('        .shadow(color: .black.opacity(0.1), radius: 4, y: 2)');
    lines.push('    }');
    lines.push('}');
    lines.push('');

    return {
        path: `Views/${entityName}CardView.swift`,
        content: lines.join('\n'),
        sourceMapping: screen.sourceFile ?? 'unknown',
        confidence: 'medium',
        warnings: [`Entity "${entityName}" not found in model — generated minimal card view`],
    };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function generateSwiftUIViews(model: SemanticAppModel): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    const screens = model.screens ?? [];

    for (const screen of screens) {
        // Main view file
        files.push(generateViewFile(screen, model));

        // Supporting sub-views (only generated when entity is not resolved inline)
        const rowView = generateRowView(screen, model);
        if (rowView) files.push(rowView);

        const cardView = generateCardView(screen, model);
        if (cardView) files.push(cardView);
    }

    return files;
}

// Re-export helpers for use by other generators
export { mapTsTypeToSwift, typeDefToSwift, defaultValueForType, pascalCase, camelCase, indent, relativeSourcePath };
