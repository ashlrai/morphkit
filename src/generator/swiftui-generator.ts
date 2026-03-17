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
    // Try common app root markers
    const markers = ['/app/', '/src/', '/pages/', '/components/'];
    for (const marker of markers) {
        const idx = fullPath.lastIndexOf(marker);
        if (idx !== -1) {
            return fullPath.slice(idx + 1); // Skip the leading /
        }
    }
    // Fallback: just the filename
    const lastSlash = fullPath.lastIndexOf('/');
    return lastSlash >= 0 ? fullPath.slice(lastSlash + 1) : fullPath;
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
            if (td.typeName) return td.typeName;
            return '[String: Any]';
        case 'enum':
            if (td.typeName) return td.typeName;
            return 'String';
        case 'union':
            if (td.typeName) return td.typeName;
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
            swiftType = resolveStatePatternType(pattern, bindingName);
            defaultValue = defaultValueForType(swiftType);
        } else {
            // Infer type from the binding name heuristics
            swiftType = inferTypeFromName(bindingName);
            defaultValue = defaultValueForType(swiftType);
        }

        bindings.push({
            wrapper: pattern?.type === 'global' ? '@State' : '@State',
            type: swiftType,
            name: camelCase(bindingName),
            defaultValue,
        });
    }

    return bindings;
}

/**
 * Resolve a StatePattern to a concrete Swift type.
 * Inspects the shape to determine the most appropriate type.
 */
function resolveStatePatternType(pattern: StatePattern, bindingName: string): string {
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

    // 3. Match by component names referencing entities
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
 * Given an Entity, extract semantically meaningful fields grouped by role.
 */
interface EntityFieldRoles {
    titleField: Field | null;
    subtitleField: Field | null;
    imageField: Field | null;
    priceField: Field | null;
    descriptionField: Field | null;
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
// Action button generation
// ---------------------------------------------------------------------------

function generateActionButton(action: UserAction, indentLevel: number): string {
    const effectTarget = action.effect?.target ?? action.label ?? 'action';
    const label = action.label && action.label !== 'inline'
        ? capitalise(action.label)
        : capitalise(camelCase(effectTarget));
    const isDestructive = action.destructive;
    const lines: string[] = [];

    if (action.effect?.type === 'navigate') {
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

    return indent(lines.join('\n'), indentLevel);
}

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
    const lines: string[] = [];

    lines.push('List {');
    lines.push(`    ForEach(${varName}s) { ${varName} in`);

    if (entity) {
        const roles = categorizeEntityFields(entity);
        lines.push('        HStack(spacing: 12) {');
        if (roles.imageField) {
            lines.push(`            AsyncImage(url: URL(string: ${varName}.${camelCase(roles.imageField.name)} ?? "")) { image in`);
            lines.push('                image.resizable().aspectRatio(contentMode: .fill)');
            lines.push('            } placeholder: {');
            lines.push('                Image(systemName: "photo.circle.fill")');
            lines.push('                    .foregroundStyle(.secondary)');
            lines.push('            }');
            lines.push('            .frame(width: 44, height: 44)');
            lines.push('            .clipShape(RoundedRectangle(cornerRadius: 8))');
        }
        lines.push('            VStack(alignment: .leading, spacing: 4) {');
        if (roles.titleField) {
            lines.push(`                Text(${varName}.${camelCase(roles.titleField.name)})`);
            lines.push('                    .font(.headline)');
        } else {
            lines.push(`                Text(String(describing: ${varName}.id))`);
            lines.push('                    .font(.headline)');
        }
        if (roles.subtitleField) {
            lines.push(`                Text(${varName}.${camelCase(roles.subtitleField.name)})`);
            lines.push('                    .font(.subheadline)');
            lines.push('                    .foregroundStyle(.secondary)');
        }
        if (roles.priceField) {
            lines.push(`                Text(${varName}.${camelCase(roles.priceField.name)}, format: .currency(code: "USD"))`);
            lines.push('                    .font(.subheadline)');
            lines.push('                    .fontWeight(.semibold)');
        }
        lines.push('            }');
        lines.push('            Spacer()');
        lines.push('        }');
    } else {
        lines.push(`        ${entityName}RowView(${varName}: ${varName})`);
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

    lines.push(`.navigationTitle("${screen.name}")`);

    return indent(lines.join('\n'), indentLevel);
}

function generateGridLayout(screen: Screen, model: SemanticAppModel, components: ComponentRef[], indentLevel: number): string {
    const entityName = deriveEntityName(screen) ?? inferEntityFromScreen(screen);
    const varName = camelCase(entityName);
    const entity = resolveEntity(screen, model);
    const lines: string[] = [];

    lines.push('let columns = [');
    lines.push('    GridItem(.adaptive(minimum: 160), spacing: 16)');
    lines.push(']');
    lines.push('');
    lines.push('ScrollView {');
    lines.push('    LazyVGrid(columns: columns, spacing: 16) {');
    lines.push(`        ForEach(${varName}s) { ${varName} in`);

    if (entity) {
        const roles = categorizeEntityFields(entity);
        lines.push('            VStack(alignment: .leading, spacing: 8) {');
        if (roles.imageField) {
            lines.push(`                AsyncImage(url: URL(string: ${varName}.${camelCase(roles.imageField.name)} ?? "")) { image in`);
            lines.push('                    image.resizable().aspectRatio(contentMode: .fill)');
            lines.push('                } placeholder: {');
            lines.push('                    Color.gray.opacity(0.2)');
            lines.push('                }');
            lines.push('                .frame(height: 120)');
            lines.push('                .clipped()');
        }
        if (roles.titleField) {
            lines.push(`                Text(${varName}.${camelCase(roles.titleField.name)})`);
            lines.push('                    .font(.headline)');
            lines.push('                    .lineLimit(2)');
        }
        if (roles.priceField) {
            lines.push(`                Text(${varName}.${camelCase(roles.priceField.name)}, format: .currency(code: "USD"))`);
            lines.push('                    .font(.subheadline)');
            lines.push('                    .fontWeight(.semibold)');
        }
        lines.push('            }');
        lines.push('            .background(Color(.systemBackground))');
        lines.push('            .clipShape(RoundedRectangle(cornerRadius: 12))');
        lines.push('            .shadow(color: .black.opacity(0.1), radius: 4, y: 2)');
    } else {
        lines.push(`            ${entityName}CardView(${varName}: ${varName})`);
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
    const entity = resolveEntity(screen, model);
    const entityName = deriveEntityName(screen) ?? inferEntityFromScreen(screen);
    const varName = camelCase(entityName);
    const lines: string[] = [];

    lines.push('ScrollView {');
    lines.push('    VStack(alignment: .leading, spacing: 16) {');

    if (entity) {
        const roles = categorizeEntityFields(entity);

        // Hero image
        if (roles.imageField) {
            lines.push(`        AsyncImage(url: URL(string: ${varName}.${camelCase(roles.imageField.name)} ?? "")) { image in`);
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

    lines.push(`.navigationTitle("${screen.name}")`);

    return indent(lines.join('\n'), indentLevel);
}

function generateDashboardLayout(screen: Screen, model: SemanticAppModel, components: ComponentRef[], indentLevel: number): string {
    const entity = resolveEntity(screen, model);
    const entityName = deriveEntityName(screen) ?? inferEntityFromScreen(screen);
    const varName = camelCase(entityName);
    const lines: string[] = [];

    lines.push('ScrollView {');
    lines.push('    VStack(spacing: 20) {');

    // Summary cards section
    lines.push('        // Summary cards');
    lines.push('        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 16) {');

    // Generate meaningful summary cards from data requirements / state
    const dataReqs = screen.dataRequirements ?? [];
    if (dataReqs.length > 0) {
        for (const req of dataReqs) {
            const reqSource = req.source ?? (req as any).entity ?? 'Item';
            const cardName = pascalCase(reqSource);
            lines.push(`            SummaryCard(title: "${cardName}", value: "\\(${camelCase(reqSource)}Count)")`);
        }
    } else {
        // Generic summary cards based on screen purpose
        lines.push('            SummaryCard(title: "Total", value: "\\(totalCount)")');
        lines.push('            SummaryCard(title: "Active", value: "\\(activeCount)")');
    }

    lines.push('        }');

    // Recent items section
    if (entity) {
        const roles = categorizeEntityFields(entity);
        lines.push('');
        lines.push(`        // Recent ${entityName.toLowerCase()}s`);
        lines.push('        VStack(alignment: .leading, spacing: 12) {');
        lines.push(`            Text("Recent ${entityName}s")`);
        lines.push('                .font(.headline)');
        lines.push('');
        lines.push(`            ForEach(${varName}s.prefix(5)) { ${varName} in`);
        lines.push('                HStack {');
        if (roles.titleField) {
            lines.push(`                    Text(${varName}.${camelCase(roles.titleField.name)})`);
            lines.push('                        .font(.body)');
        } else {
            lines.push(`                    Text(String(describing: ${varName}.id))`);
            lines.push('                        .font(.body)');
        }
        lines.push('                    Spacer()');
        if (roles.subtitleField) {
            lines.push(`                    Text(${varName}.${camelCase(roles.subtitleField.name)})`);
            lines.push('                        .font(.caption)');
            lines.push('                        .foregroundStyle(.secondary)');
        }
        lines.push('                }');
        lines.push('                Divider()');
        lines.push('            }');
        lines.push('        }');
    } else {
        lines.push('');
        lines.push('        // Recent activity');
        lines.push('        VStack(alignment: .leading, spacing: 12) {');
        lines.push('            Text("Recent Activity")');
        lines.push('                .font(.headline)');
        lines.push('');
        lines.push('            ForEach(recentItems) { item in');
        lines.push('                HStack {');
        lines.push('                    Text(item.title)');
        lines.push('                    Spacer()');
        lines.push('                    Text(item.subtitle)');
        lines.push('                        .foregroundStyle(.secondary)');
        lines.push('                }');
        lines.push('                Divider()');
        lines.push('            }');
        lines.push('        }');
    }

    // Action buttons at the bottom
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
            lines.push(`        AsyncImage(url: URL(string: profile.${camelCase(roles.imageField.name)} ?? "")) { image in`);
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
    lines.push('        .foregroundStyle(.accent)');
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
                lines.push('        .autocapitalization(.none)');
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
        lines.push('        .autocapitalization(.none)');
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
 * Generate a layout for screens with layout type 'custom'.
 * This is the fallback that needs to be smart enough to produce meaningful views
 * from data requirements, actions, components, and screen metadata.
 */
function generateCustomLayout(screen: Screen, model: SemanticAppModel, components: ComponentRef[], indentLevel: number): string {
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
            lines.push(`        ForEach(${varName}s) { ${varName} in`);
            lines.push('            HStack(spacing: 12) {');
            if (roles.imageField) {
                lines.push(`                AsyncImage(url: URL(string: ${varName}.${camelCase(roles.imageField.name)} ?? "")) { image in`);
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
                return `Button("${comp.label ?? 'Action'}") {\n    // TODO: Handle action\n}`;
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
                return `Picker("${comp.label ?? ''}", selection: $${camelCase(comp.binding ?? 'selection')}) {\n    // TODO: Add picker options\n}`;
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
            return `Picker("${comp.label ?? ''}", selection: $${camelCase(comp.binding ?? 'selection')}) {\n            // TODO: Add options\n        }`;
        case 'date-picker':
            return `DatePicker("${comp.label ?? ''}", selection: $${camelCase(comp.binding ?? 'date')})`;
        case 'slider':
            return `Slider(value: $${camelCase(comp.binding ?? 'value')})`;
        case 'stepper':
            return `Stepper("${comp.label ?? ''}", value: $${camelCase(comp.binding ?? 'value')})`;
        case 'button':
            return `Button("${comp.label ?? 'Submit'}") {\n            // TODO: Handle action\n        }`;
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
    const name = screen.name;
    if (name.endsWith('s') && name.length > 1) {
        return pascalCase(name.slice(0, -1));
    }
    return pascalCase(name);
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

    // Entity-based properties for list/grid layouts when no explicit data requirements
    const entityName = deriveEntityName(screen);
    if (entityName && (screen.layout === 'list' || screen.layout === 'grid')) {
        const varName = camelCase(entityName);
        const arrayVarName = varName.endsWith('s') ? varName : `${varName}s`;
        if (!declaredNames.has(arrayVarName)) {
            lines.push(`    @State private var ${arrayVarName}: [${entityName}] = []`);
            declaredNames.add(arrayVarName);
        }
    }

    // For custom layouts with repeated components, generate array state
    if (screen.layout === 'custom' || !screen.layout) {
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
    if (hasApiData || needsAsyncLoading(screen)) {
        if (!declaredNames.has('isLoading')) {
            lines.push('    @State private var isLoading = false');
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

    if (declaredNames.size > 0) {
        lines.push('');
    }

    // Body
    lines.push('    var body: some View {');
    lines.push(generateLayoutBody(screen, model, 2));

    // Add .task modifier for async data loading
    if (hasApiData) {
        lines.push(indent('.task {', 2));
        lines.push(indent('    await loadData()', 2));
        lines.push(indent('}', 2));
        lines.push(indent('.overlay {', 2));
        lines.push(indent('    if isLoading {', 2));
        lines.push(indent('        ProgressView()', 2));
        lines.push(indent('    }', 2));
        lines.push(indent('}', 2));
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
        for (const req of dataReqs) {
            if (req.fetchStrategy === 'api' || req.fetchStrategy === 'context') {
                const reqSource = req.source ?? (req as any).entity;
                if (!reqSource) continue;
                const varName = camelCase(reqSource);
                const arrayVarName = (req.cardinality === 'many' || (req as any).type === 'list')
                    ? (varName.endsWith('s') ? varName : `${varName}s`)
                    : varName;
                lines.push(`            ${arrayVarName} = try await fetch${pascalCase(reqSource)}()`);
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
            lines.push(`        // TODO: Implement ${humanizeActionTarget(target).toLowerCase()}`);
            lines.push('    }');
        }
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
    lines.push(`        ${viewName}(${hasBindings ? '/* pass bindings */' : ''})`);
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
        warnings.push('Dashboard layouts require manual refinement');
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
    lines.push('        .background(Color(.systemBackground))');
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
