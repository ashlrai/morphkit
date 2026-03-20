// Morphkit Swift Model Generator
// Converts Semantic App Model entities into Codable Swift structs

import type {
    SemanticAppModel,
    Entity,
    ConfidenceLevel,
    TypeDefinition,
    Field,
} from '../semantic/model';

import type { GeneratedFile } from './swiftui-generator';
import { mapTsTypeToSwift, typeDefToSwift, pascalCase, camelCase, indent, relativeSourcePath, isValidSwiftFieldName } from './swiftui-generator';

// ---------------------------------------------------------------------------
// Field type analysis
// ---------------------------------------------------------------------------

interface SwiftField {
    name: string;
    type: string;
    originalName: string;
    isOptional: boolean;
    isArray: boolean;
    isId: boolean;
    isPrimaryKey: boolean;
    needsCodingKey: boolean;
    defaultValue?: string;
    comment?: string;
}

/**
 * Convert a TypeDefinition to a raw string representation for mapTsTypeToSwift,
 * or use typeDefToSwift directly for structured types.
 * Includes a guard to catch any leaked TS/JS syntax in the result.
 */
function typeDefinitionToSwiftType(td: TypeDefinition): string {
    let result = typeDefToSwift(td);
    // Final safety net: if the resolved type still contains TS/JS syntax, fall back
    if (/[<>|{}]|=>/.test(result)) {
        result = 'String';
    }
    // Catch leaked import paths (e.g., Prisma enums: Import("...").$Enums.Status)
    if (/Import\(|import\(|node_modules|\.prisma|\.\/|\.\.\//.test(result)) {
        result = 'String';
    }
    return result;
}

function analyseField(field: Field): SwiftField {
    const name = camelCase(field.name);
    const originalName = field.name;
    const needsCodingKey = name !== originalName;

    const td: TypeDefinition = field.type;
    const isOptional = field.optional === true;
    const isArray = td.kind === 'array';

    let swiftType = typeDefinitionToSwiftType(td);

    // Sanitize: if the resolved type contains TS/JS syntax, fall back to safe types
    if (/[<>{}|]|=>/.test(swiftType)) {
        swiftType = isOptional ? 'String?' : 'String';
    }
    // Map TS primitive names that may have leaked through
    if (swiftType === 'Number') swiftType = 'Double';
    if (swiftType === 'Boolean') swiftType = 'Bool';
    // Replace Any-containing types that break Codable/Hashable conformance
    if (swiftType === 'Any') swiftType = 'String';
    if (swiftType === '[Any]') swiftType = '[String]';
    if (swiftType === '[String: Any]') swiftType = '[String: String]';
    if (swiftType.includes('[String: Any]')) swiftType = swiftType.replace('[String: Any]', '[String: String]');
    if (swiftType === 'Any?') swiftType = 'String?';

    // Detect integer types from hints or naming
    const isInteger =
        name.toLowerCase().endsWith('count') ||
        name.toLowerCase().endsWith('index') ||
        name.toLowerCase() === 'id' ||
        name.toLowerCase().endsWith('id') ||
        name.toLowerCase() === 'quantity' ||
        name.toLowerCase() === 'age';

    // Override Double → Int where appropriate
    if (isInteger && (swiftType === 'Double' || swiftType === 'Double?')) {
        swiftType = swiftType.replace('Double', 'Int');
    }

    // Ensure optionality is reflected in the type
    if (isOptional && !swiftType.endsWith('?')) {
        swiftType = `${swiftType}?`;
    }

    const isId = name === 'id' || field.isPrimaryKey === true;
    const isPrimaryKey = field.isPrimaryKey === true;

    return {
        name,
        type: swiftType,
        originalName,
        isOptional,
        isArray,
        isId,
        isPrimaryKey,
        needsCodingKey,
        comment: field.description,
    };
}

// ---------------------------------------------------------------------------
// Enum detection & generation
// ---------------------------------------------------------------------------

/**
 * Detect whether an entity represents a string union enum.
 * These are created by the builder when it encounters type aliases like:
 *   type SortOrder = 'price-asc' | 'price-desc' | 'name' | 'rating'
 * They have a single field named '__enum' with kind 'enum' and values.
 */
function isEnumEntity(entity: Entity): boolean {
    const fields = entity.fields ?? [];
    return (
        fields.length === 1 &&
        fields[0].name === '__enum' &&
        fields[0].type.kind === 'enum' &&
        Array.isArray(fields[0].type.values) &&
        fields[0].type.values.length >= 2
    );
}

/** Swift reserved keywords that require backtick escaping in enum case names */
const SWIFT_KEYWORDS = new Set([
    'default', 'case', 'return', 'class', 'struct', 'enum', 'func',
    'var', 'let', 'for', 'in', 'if', 'else', 'switch', 'true', 'false',
    'nil', 'do', 'try', 'catch', 'throw', 'import', 'self', 'super',
    'init', 'deinit', 'guard', 'where', 'while', 'repeat', 'break',
    'continue', 'type', 'protocol', 'extension', 'as', 'is', 'get', 'set',
]);

/**
 * Convert a kebab-case or arbitrary string value to a valid Swift camelCase
 * enum case name.  e.g. 'price-asc' → 'priceAsc', 'name' → 'name'
 */
function enumCaseName(value: string): string {
    // Split on hyphens, underscores, spaces
    const parts = value.split(/[-_ ]+/);
    let result: string;
    if (parts.length === 1) {
        result = parts[0];
    } else {
        result = parts[0] + parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
    }
    // Ensure the first character is lowercase (valid Swift enum case)
    result = result.charAt(0).toLowerCase() + result.slice(1);
    // If the result starts with a digit or is a Swift keyword, prefix with backticks
    if (/^\d/.test(result) || SWIFT_KEYWORDS.has(result)) {
        result = '`' + result + '`';
    }
    return result;
}

/**
 * Generate a Swift enum with String raw values from a string union entity.
 */
function generateEnum(entity: Entity): string {
    const enumName = pascalCase(entity.name);
    const values = entity.fields[0].type.values as string[];
    const lines: string[] = [];

    if (entity.description) {
        lines.push(`/// ${entity.description}`);
    }

    lines.push(`enum ${enumName}: String, Codable, CaseIterable {`);

    for (const value of values) {
        const caseName = enumCaseName(value);
        // Only emit raw value if it differs from the case name
        if (caseName === value) {
            lines.push(`    case ${caseName}`);
        } else {
            lines.push(`    case ${caseName} = "${value}"`);
        }
    }

    lines.push('}');
    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Field filtering — shared pipeline for struct and preview generation
// ---------------------------------------------------------------------------

/** Filter raw entity fields to only those valid for Swift code generation */
function filterSwiftFields(fields: Field[]): Field[] {
    return fields
        .filter(f => isValidSwiftFieldName(f.name))
        .filter(f => !JS_BUILTIN_FIELDS.has(f.name))
        .filter(f => !/=>/.test(JSON.stringify(f.type ?? {})));
}

// ---------------------------------------------------------------------------
// Struct generation
// ---------------------------------------------------------------------------

function generateStruct(entity: Entity, model: SemanticAppModel): string {
    const structName = pascalCase(entity.name);
    const fields = filterSwiftFields(entity.fields ?? []).map(analyseField);
    const hasId = fields.some((f) => f.isId);
    const needsCodingKeys = fields.some((f) => f.needsCodingKey);

    const protocols: string[] = ['Codable', 'Identifiable', 'Hashable'];

    const lines: string[] = [];

    // Doc comment
    if (entity.description) {
        lines.push(`/// ${entity.description}`);
    }

    // Struct declaration
    lines.push(`struct ${structName}: ${protocols.join(', ')} {`);

    // Synthesised id if needed
    if (!hasId) {
        lines.push('    let id: UUID');
        lines.push('');
    }

    // Properties
    for (const field of fields) {
        if (field.comment) {
            lines.push(`    /// ${field.comment}`);
        }

        const keyword = field.isId && !field.isOptional ? 'let' : 'var';

        if (field.defaultValue !== undefined) {
            lines.push(`    ${keyword} ${field.name}: ${field.type} = ${formatDefaultValue(field.defaultValue, field.type)}`);
        } else {
            lines.push(`    ${keyword} ${field.name}: ${field.type}`);
        }
    }

    // CodingKeys
    if (needsCodingKeys || !hasId) {
        lines.push('');
        lines.push('    enum CodingKeys: String, CodingKey {');
        if (!hasId) {
            lines.push('        case id');
        }
        for (const field of fields) {
            if (field.needsCodingKey) {
                lines.push(`        case ${field.name} = "${field.originalName}"`);
            } else {
                lines.push(`        case ${field.name}`);
            }
        }
        lines.push('    }');
    }

    // Custom init(from:) if we need a synthesised id
    if (!hasId) {
        lines.push('');
        lines.push('    init(from decoder: Decoder) throws {');
        lines.push('        let container = try decoder.container(keyedBy: CodingKeys.self)');
        lines.push('        self.id = (try? container.decode(UUID.self, forKey: .id)) ?? UUID()');
        for (const field of fields) {
            if (field.isOptional) {
                lines.push(`        self.${field.name} = try container.decodeIfPresent(${baseType(field.type)}.self, forKey: .${field.name})`);
            } else {
                lines.push(`        self.${field.name} = try container.decode(${field.type}.self, forKey: .${field.name})`);
            }
        }
        lines.push('    }');

        // Memberwise init
        lines.push('');
        const initParams = [`id: UUID = UUID()`];
        for (const field of fields) {
            if (field.defaultValue !== undefined) {
                initParams.push(`${field.name}: ${field.type} = ${formatDefaultValue(field.defaultValue, field.type)}`);
            } else if (field.isOptional) {
                initParams.push(`${field.name}: ${field.type} = nil`);
            } else {
                initParams.push(`${field.name}: ${field.type}`);
            }
        }

        if (initParams.join(', ').length > 80) {
            lines.push('    init(');
            for (let i = 0; i < initParams.length; i++) {
                const trailing = i < initParams.length - 1 ? ',' : '';
                lines.push(`        ${initParams[i]}${trailing}`);
            }
            lines.push('    ) {');
        } else {
            lines.push(`    init(${initParams.join(', ')}) {`);
        }

        lines.push('        self.id = id');
        for (const field of fields) {
            lines.push(`        self.${field.name} = ${field.name}`);
        }
        lines.push('    }');
    }

    lines.push('}');

    return lines.join('\n');
}

function baseType(swiftType: string): string {
    return swiftType.replace('?', '');
}

function formatDefaultValue(value: any, swiftType: string): string {
    if (typeof value === 'string') {
        if (swiftType === 'String' || swiftType === 'String?') {
            return `"${value}"`;
        }
        return value;
    }
    if (typeof value === 'boolean') {
        return value ? 'true' : 'false';
    }
    if (typeof value === 'number') {
        return String(value);
    }
    return String(value);
}

// ---------------------------------------------------------------------------
// Preview data factory generation
// ---------------------------------------------------------------------------

/**
 * Generate a sensible preview default value for a Swift field based on its
 * name and type.  Used to build `static func preview()` factory methods.
 */
function previewValue(field: SwiftField, entityName: string, enumNames?: Map<string, string>): string {
    const nameLower = field.name.toLowerCase();
    const baseSwiftType = field.type.replace('?', '');

    // Optional fields → nil
    if (field.isOptional) return 'nil';

    // Array fields → empty array
    if (field.isArray) return '[]';

    // Type-based overrides FIRST — prevents name heuristics from producing
    // wrong types (e.g., field named "email" with type Bool)
    if (baseSwiftType === 'Bool') return 'true';
    if (baseSwiftType === 'Int') {
        // Use name-based values for Int
        if (nameLower === 'quantity' || nameLower === 'count') return '1';
        return '1';
    }
    if (baseSwiftType === 'Double') {
        if (nameLower === 'price' || nameLower === 'cost' || nameLower === 'amount') return '29.99';
        if (nameLower === 'rating' || nameLower === 'score') return '4.5';
        return '0.0';
    }
    if (baseSwiftType === 'Date') return '.now';
    if (baseSwiftType === 'UUID') return 'UUID()';

    // ID fields
    if (field.isId) {
        if (field.type === 'UUID' || field.type === 'UUID?') return 'UUID()';
        return '"preview-1"';
    }

    // Enum type → use first case (checked BEFORE name heuristics so that
    // fields named "category", "type", etc. get a proper enum case instead
    // of the String literal "Sample" when their declared type is an enum)
    if (enumNames) {
        const firstCase = enumNames.get(baseSwiftType);
        if (firstCase !== undefined) {
            return `.${firstCase}`;
        }
    }

    // Name-based heuristics (checked before pure-type heuristics).
    // Each heuristic guards on baseSwiftType to avoid producing a value
    // that doesn't match the field's declared type.
    if (nameLower === 'name' || nameLower === 'title') return `"Sample ${entityName}"`;
    if (nameLower === 'description' || nameLower === 'desc' || nameLower === 'summary') {
        return `"A sample ${entityName.charAt(0).toLowerCase() + entityName.slice(1)} for previewing"`;
    }
    if ((nameLower === 'price' || nameLower === 'cost' || nameLower === 'amount') && baseSwiftType === 'Double') return '29.99';
    if (nameLower === 'imageurl' || nameLower === 'image' || nameLower === 'thumbnailurl' || nameLower === 'thumbnail' || nameLower === 'avatar' || nameLower === 'avatarurl' || nameLower === 'photo' || nameLower === 'photourl') {
        return '"https://picsum.photos/200"';
    }
    if (nameLower === 'email') return '"preview@example.com"';
    if (nameLower === 'url' || nameLower === 'link' || nameLower === 'href' || nameLower === 'website') return '"https://example.com"';
    if (nameLower === 'phone' || nameLower === 'phonenumber') return '"+1 555-0100"';
    if ((nameLower === 'category' || nameLower === 'type' || nameLower === 'kind' || nameLower === 'group') && baseSwiftType === 'String') return '"Sample"';
    if ((nameLower === 'rating' || nameLower === 'score') && (baseSwiftType === 'Double' || baseSwiftType === 'Int')) return '4.5';
    if ((nameLower === 'quantity' || nameLower === 'count') && (baseSwiftType === 'Int' || baseSwiftType === 'Double')) return '1';

    // String fallback for remaining String fields
    if (baseSwiftType === 'String') return '"Sample"';

    // Nested entity → .preview()
    // Detect by PascalCase type name that isn't a Swift stdlib type
    if (/^[A-Z][a-zA-Z0-9]+$/.test(baseSwiftType) && !['String', 'Int', 'Double', 'Bool', 'Date', 'UUID', 'URL', 'Data', 'Any'].includes(baseSwiftType)) {
        return `.preview()`;
    }

    // Dictionary — check BEFORE array since both start with '['
    if (baseSwiftType.startsWith('[') && baseSwiftType.includes(':')) {
        return '[:]';
    }

    // Array of entities
    if (baseSwiftType.startsWith('[') && baseSwiftType.endsWith(']')) {
        return '[]';
    }

    return '""';
}

/**
 * Generate a `#if DEBUG` extension with a static `preview()` factory method
 * for a struct entity.
 */
function generatePreviewExtension(entity: Entity, model: SemanticAppModel): string {
    const structName = pascalCase(entity.name);
    const fields = filterSwiftFields(entity.fields ?? []).map(analyseField);
    const hasId = fields.some((f) => f.isId);

    // Build enum lookup: PascalCase entity name → first case name
    const enumNames = new Map<string, string>();
    for (const e of (model.entities ?? [])) {
        if (isEnumEntity(e)) {
            const values = e.fields[0].type.values as string[];
            if (values.length > 0) {
                enumNames.set(pascalCase(e.name), enumCaseName(values[0]));
            }
        }
    }

    const lines: string[] = [];
    lines.push('#if DEBUG');
    lines.push(`extension ${structName} {`);
    lines.push(`    static func preview() -> ${structName} {`);

    // Build the initializer call
    const initArgs: string[] = [];

    // Add synthesised id if struct doesn't have one naturally
    if (!hasId) {
        initArgs.push(`id: UUID()`);
    }

    for (const field of fields) {
        const value = previewValue(field, structName, enumNames);
        initArgs.push(`${field.name}: ${value}`);
    }

    // Format: single line if short, multi-line otherwise
    const singleLine = `${structName}(${initArgs.join(', ')})`;
    if (singleLine.length <= 80) {
        lines.push(`        ${singleLine}`);
    } else {
        lines.push(`        ${structName}(`);
        for (let i = 0; i < initArgs.length; i++) {
            const trailing = i < initArgs.length - 1 ? ',' : '';
            lines.push(`            ${initArgs[i]}${trailing}`);
        }
        lines.push('        )');
    }

    lines.push('    }');
    lines.push('}');
    lines.push('#endif');

    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// File grouping — group by sourceFile
// ---------------------------------------------------------------------------

function groupEntities(entities: Entity[]): Map<string, Entity[]> {
    const groups = new Map<string, Entity[]>();

    for (const entity of entities) {
        // Extract just the filename (without extension) from the source path,
        // rather than using the full absolute path as the group key
        let group = 'Models';
        if (entity.sourceFile) {
            const parts = entity.sourceFile.split('/');
            const filename = parts[parts.length - 1] ?? 'Models';
            group = filename.replace(/\.[^.]+$/, ''); // strip extension
        }
        if (!groups.has(group)) {
            groups.set(group, []);
        }
        groups.get(group)!.push(entity);
    }

    return groups;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Names that are not valid Swift struct/enum names — skip generating models for these */
const JUNK_ENTITY_NAMES = new Set([
    'any', 'unknown', 'object', 'request', 'response', 'void', 'undefined', 'null',
    'promise', 'promise<any>', 'promise<response>', 'promise<void>',
    'nextrequest', 'nextresponse', 'nextapiresponse',
    'error', 'function', 'array',
]);

/** JS built-in method names that indicate a leaked prototype, not real data fields */
const JS_BUILTIN_FIELDS = new Set([
    // String prototype
    'charAt', 'charCodeAt', 'codePointAt', 'indexOf', 'lastIndexOf',
    'slice', 'substring', 'substr', 'toLowerCase', 'toUpperCase',
    'toLocaleLowerCase', 'toLocaleUpperCase', 'trim', 'trimStart', 'trimEnd',
    'split', 'replace', 'replaceAll', 'match', 'matchAll',
    'concat', 'includes', 'startsWith', 'endsWith', 'repeat',
    'padStart', 'padEnd', 'search', 'toString', 'valueOf',
    'localeCompare', 'normalize', 'at',
    // String HTML methods (deprecated but still on prototype)
    'anchor', 'big', 'blink', 'bold', 'fixed', 'fontcolor', 'fontsize',
    'italics', 'link', 'small', 'strike', 'sub', 'sup',
    // String/Array shared
    'length',
    // Array prototype
    'map', 'filter', 'reduce', 'reduceRight', 'forEach', 'find', 'findIndex',
    'findLast', 'findLastIndex', 'some', 'every', 'flat', 'flatMap',
    'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse',
    'join', 'keys', 'values', 'entries', 'fill', 'copyWithin',
    // Promise prototype
    'then', 'catch', 'finally', 'resolve', 'reject', 'all', 'race',
    'allSettled', 'any',
    // Function/Object prototype
    'apply', 'call', 'bind', 'constructor', 'prototype', 'hasOwnProperty',
    'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString',
    // Iterator protocol
    'next', 'return', 'throw',
    // Symbol-adjacent
    'Symbol', 'iterator', 'toPrimitive', 'toStringTag',
]);

/** Swift standard library and framework type names that would cause conflicts */
const SWIFT_STDLIB_CONFLICTS = new Set([
    // Swift stdlib
    'collection', 'error', 'type', 'result', 'optional', 'array',
    'dictionary', 'set', 'range', 'sequence', 'iterator',
    'encoder', 'decoder', 'mirror', 'index', 'element',
    'string', 'int', 'double', 'float', 'bool', 'date', 'url', 'data', 'uuid',
    // SwiftUI/UIKit types
    'color', 'accentcolor', 'image', 'text', 'button', 'view', 'font',
    'navigationpath', 'state', 'binding', 'environment', 'observable',
    // Foundation
    'notification', 'timer', 'locale', 'calendar', 'timezone',
]);

export function isJunkEntity(entity: Entity): boolean {
    const lower = entity.name.toLowerCase();
    if (JUNK_ENTITY_NAMES.has(lower)) return true;
    // Filter entities whose names conflict with Swift stdlib types
    if (SWIFT_STDLIB_CONFLICTS.has(lower)) return true;
    // Filter entities whose names contain invalid Swift characters (e.g., angle brackets)
    if (/[<>(){}[\]]/.test(entity.name)) return true;
    // Filter entities with all-unknown typed fields (no useful type information)
    const fields = entity.fields ?? [];
    if (fields.length > 0 && fields.every(f => f.type.kind === 'unknown')) return true;
    // Filter entities that look like leaked JS prototypes (fields are built-in method names)
    if (fields.length >= 3) {
        const builtinCount = fields.filter(f => JS_BUILTIN_FIELDS.has(f.name)).length;
        if (builtinCount >= 3 || builtinCount > fields.length * 0.5) return true;

        // Also detect leaked prototypes via arrow function types in field definitions.
        // Check typeName AND serialized type object — some leaks only show in nested props.
        const arrowTypeCount = fields.filter(f => {
            const typeName = f.type.typeName ?? '';
            if (/=>/.test(typeName)) return true;
            // Deep check: serialize the full type definition to catch nested arrow syntax
            try {
                return /=>/.test(JSON.stringify(f.type));
            } catch {
                return false;
            }
        }).length;
        // If 3+ fields have arrow function types, or >30% of fields do, it's a leaked prototype
        if (arrowTypeCount >= 3 || arrowTypeCount > fields.length * 0.3) return true;
    }
    // Single-field arrow type check for smaller entities
    if (fields.some(f => /=>/.test(f.type.typeName ?? ''))) return true;
    return false;
}

// ---------------------------------------------------------------------------
// SwiftData eligibility
// ---------------------------------------------------------------------------

export function isSwiftDataEligible(entity: Entity): boolean {
    if (isJunkEntity(entity)) return false;
    if (isEnumEntity(entity)) return false;
    const confidence = entity.confidence ?? 'medium';
    if (confidence === 'low') return false;
    const validFields = filterSwiftFields(entity.fields ?? []);
    if (validFields.length < 2) return false;
    const nonIdFields = validFields.filter(f => f.name !== 'id' && f.name !== '__enum');
    if (nonIdFields.length === 0) return false;
    return true;
}

export function getSwiftDataEligibleEntities(model: SemanticAppModel): Entity[] {
    return (model.entities ?? []).filter(isSwiftDataEligible);
}

// ---------------------------------------------------------------------------
// SwiftData model generation
// ---------------------------------------------------------------------------

function swiftDataFieldType(swiftType: string): string {
    const base = swiftType.replace('?', '');
    const isOpt = swiftType.endsWith('?');
    const nativeTypes = new Set(['String', 'Int', 'Double', 'Float', 'Bool', 'Date', 'UUID', 'Data', 'URL']);
    if (nativeTypes.has(base)) return swiftType;
    if (base.startsWith('[') && base.endsWith(']')) {
        const elementType = base.slice(1, -1);
        if (nativeTypes.has(elementType)) return swiftType;
        return isOpt ? 'Data?' : 'Data';
    }
    if (base.startsWith('[') && base.includes(':')) return isOpt ? 'Data?' : 'Data';
    return isOpt ? 'String?' : 'String';
}

function generateSwiftDataModel(entity: Entity, model: SemanticAppModel): string {
    const structName = pascalCase(entity.name);
    const storeName = `${structName}Record`;
    const fields = filterSwiftFields(entity.fields ?? []).map(analyseField);
    const hasId = fields.some((f) => f.isId);
    const relationships = entity.relationships ?? [];
    const relationshipFieldNames = new Set(relationships.map(r => camelCase(r.fieldName)));
    const lines: string[] = [];

    lines.push('@Model');
    lines.push(`final class ${storeName} {`);
    if (!hasId) { lines.push('    var id: UUID'); lines.push(''); }

    for (const field of fields) {
        if (field.isPrimaryKey || field.isId) lines.push('    @Attribute(.unique)');
        if (relationshipFieldNames.has(field.name)) {
            const rel = relationships.find(r => camelCase(r.fieldName) === field.name);
            if (rel) {
                const targetStore = `${pascalCase(rel.targetEntity)}Record`;
                if (rel.type === 'one-to-many' || rel.type === 'many-to-many') {
                    lines.push(`    @Relationship var ${field.name}: [${targetStore}]`);
                } else {
                    lines.push(`    @Relationship var ${field.name}: ${targetStore}?`);
                }
                continue;
            }
        }
        lines.push(`    var ${field.name}: ${swiftDataFieldType(field.type)}`);
    }

    // Init
    lines.push('');
    const initParams: string[] = [];
    if (!hasId) initParams.push('id: UUID = UUID()');
    for (const field of fields) {
        if (relationshipFieldNames.has(field.name)) continue;
        const sdType = swiftDataFieldType(field.type);
        if (field.isOptional) initParams.push(`${field.name}: ${sdType} = nil`);
        else if (field.isId && sdType === 'UUID') initParams.push(`${field.name}: ${sdType} = UUID()`);
        else initParams.push(`${field.name}: ${sdType}`);
    }
    lines.push(`    init(${initParams.join(', ')}) {`);
    if (!hasId) lines.push('        self.id = id');
    for (const field of fields) {
        if (relationshipFieldNames.has(field.name)) continue;
        lines.push(`        self.${field.name} = ${field.name}`);
    }
    lines.push('    }');

    // Convenience init from Codable
    lines.push('');
    lines.push(`    convenience init(from model: ${structName}) {`);
    const convArgs: string[] = [];
    if (!hasId) convArgs.push('id: model.id');
    for (const field of fields) {
        if (relationshipFieldNames.has(field.name)) continue;
        const sdType = swiftDataFieldType(field.type);
        if (sdType.replace('?', '') === 'Data' && field.type.replace('?', '') !== 'Data') {
            // Type needs JSON encoding: [String: String] → Data
            if (field.isOptional) {
                convArgs.push(`${field.name}: (try? JSONEncoder().encode(model.${field.name})) ?? nil`);
            } else {
                convArgs.push(`${field.name}: (try? JSONEncoder().encode(model.${field.name})) ?? Data()`);
            }
        } else if (sdType.replace('?', '') === 'String' && field.type.replace('?', '') !== 'String' && !field.type.startsWith('[')) {
            // Non-string type stored as String
            convArgs.push(`${field.name}: String(describing: model.${field.name})`);
        } else {
            convArgs.push(`${field.name}: model.${field.name}`);
        }
    }
    lines.push(`        self.init(${convArgs.join(', ')})`);
    lines.push('    }');

    // toModel()
    lines.push('');
    lines.push(`    func toModel() -> ${structName} {`);
    const modelArgs: string[] = [];
    if (!hasId) modelArgs.push('id: id');
    for (const field of fields) {
        if (relationshipFieldNames.has(field.name)) continue;
        const sdType = swiftDataFieldType(field.type);
        if (sdType.replace('?', '') === 'Data' && field.type.replace('?', '') !== 'Data') {
            // Data → decode back to original type
            if (field.isOptional) {
                modelArgs.push(`${field.name}: ${field.name}.flatMap { try? JSONDecoder().decode(${field.type.replace('?', '')}.self, from: $0) }`);
            } else {
                modelArgs.push(`${field.name}: (try? JSONDecoder().decode(${field.type}.self, from: ${field.name})) ?? ${field.type}()`);
            }
        } else {
            modelArgs.push(`${field.name}: ${field.name}`);
        }
    }
    lines.push(`        ${structName}(${modelArgs.join(', ')})`);
    lines.push('    }');
    lines.push('}');

    return lines.join('\n');
}

export function generateSwiftDataModels(model: SemanticAppModel): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    const eligible = getSwiftDataEligibleEntities(model);
    if (eligible.length === 0) return files;

    const groups = groupEntities(eligible);
    for (const [groupKey, groupEntities] of groups) {
        const lines: string[] = [];
        const groupFileName = groupEntities.length === 1
            ? `${pascalCase(groupEntities[0].name)}DataStore.swift`
            : `${pascalCase(groupKey)}DataStores.swift`;
        const sourceRef = groupEntities[0]?.sourceFile ? relativeSourcePath(groupEntities[0].sourceFile) : groupKey;
        lines.push(`// Generated by Morphkit`);
        lines.push(`// SwiftData persistence models from: ${sourceRef}`);
        lines.push('');
        lines.push('import Foundation');
        lines.push('import SwiftData');
        lines.push('');
        for (const entity of groupEntities) { lines.push(generateSwiftDataModel(entity, model)); lines.push(''); }
        files.push({ path: `Models/${groupFileName}`, content: lines.join('\n'), sourceMapping: groupKey, confidence: 'high', warnings: [] });
    }
    return files;
}

export function generateDataManager(model: SemanticAppModel): GeneratedFile | null {
    const eligible = getSwiftDataEligibleEntities(model);
    if (eligible.length === 0) return null;

    const lines: string[] = [];
    lines.push('// Generated by Morphkit');
    lines.push('');
    lines.push('import SwiftData');
    lines.push('import Foundation');
    lines.push('');
    lines.push('@Observable');
    lines.push('final class DataManager {');
    lines.push('    static let shared = DataManager()');
    lines.push('');
    lines.push('    private var modelContext: ModelContext?');
    lines.push('');
    lines.push('    func configure(with context: ModelContext) {');
    lines.push('        self.modelContext = context');
    lines.push('    }');

    for (const entity of eligible) {
        const structName = pascalCase(entity.name);
        const storeName = `${structName}Record`;
        const varName = camelCase(entity.name);
        const pluralVar = varName.endsWith('s') ? varName : `${varName}s`;
        lines.push('');
        lines.push(`    // MARK: - ${structName}`);
        lines.push('');
        lines.push(`    func save${structName}s(_ ${pluralVar}: [${structName}]) throws {`);
        lines.push('        guard let context = modelContext else { return }');
        lines.push(`        for item in ${pluralVar} { context.insert(${storeName}(from: item)) }`);
        lines.push('        try context.save()');
        lines.push('    }');
        lines.push('');
        lines.push(`    func save${structName}(_ ${varName}: ${structName}) throws {`);
        lines.push('        guard let context = modelContext else { return }');
        lines.push(`        context.insert(${storeName}(from: ${varName}))`);
        lines.push('        try context.save()');
        lines.push('    }');
        lines.push('');
        lines.push(`    func fetchCached${structName}s() throws -> [${structName}] {`);
        lines.push('        guard let context = modelContext else { return [] }');
        lines.push(`        return try context.fetch(FetchDescriptor<${storeName}>()).map { $0.toModel() }`);
        lines.push('    }');
        lines.push('');
        lines.push(`    func deleteAll${structName}s() throws {`);
        lines.push('        guard let context = modelContext else { return }');
        lines.push(`        try context.delete(model: ${storeName}.self)`);
        lines.push('        try context.save()');
        lines.push('    }');
    }

    lines.push('}');
    lines.push('');
    return { path: 'State/DataManager.swift', content: lines.join('\n'), sourceMapping: 'morphkit:persistence', confidence: 'high', warnings: [] };
}

export function generateSwiftModels(model: SemanticAppModel): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    const entities = (model.entities ?? []).filter(e => !isJunkEntity(e));

    if (entities.length === 0) {
        return files;
    }

    const groups = groupEntities(entities);

    for (const [groupKey, groupEntities] of groups) {
        const warnings: string[] = [];
        const structs: string[] = [];

        // Header
        const groupFileName = groupEntities.length === 1
            ? `${pascalCase(groupEntities[0].name)}.swift`
            : `${pascalCase(groupKey)}Models.swift`;

        // Use the relative source path from the first entity in the group
        const sourceRef = groupEntities[0]?.sourceFile
            ? relativeSourcePath(groupEntities[0].sourceFile)
            : groupKey;
        structs.push(`// Generated by Morphkit from: ${sourceRef}`);
        structs.push('');
        structs.push('import Foundation');
        structs.push('');

        // Collect struct entities for preview extension generation
        const structEntities: Entity[] = [];

        for (const entity of groupEntities) {
            if (isEnumEntity(entity)) {
                structs.push(generateEnum(entity));
            } else {
                structs.push(generateStruct(entity, model));
                structEntities.push(entity);
            }
            structs.push('');

            // Validate
            const fields = entity.fields ?? [];
            if (fields.length === 0) {
                warnings.push(`Entity "${entity.name}" has no fields`);
            }
        }

        // Generate #if DEBUG preview() factory extensions for struct entities
        if (structEntities.length > 0) {
            structs.push('// MARK: - Preview Data');
            structs.push('');
            for (const entity of structEntities) {
                structs.push(generatePreviewExtension(entity, model));
                structs.push('');
            }
        }

        // Determine confidence
        let confidence: 'high' | 'medium' | 'low' = 'high';
        if (warnings.length > 0) confidence = 'medium';
        for (const entity of groupEntities) {
            const fields = entity.fields ?? [];
            const hasAnyType = fields.some((f) => f.type.kind === 'unknown');
            if (hasAnyType) {
                confidence = 'low';
                warnings.push(`Entity "${entity.name}" contains "unknown" typed fields`);
            }
        }

        files.push({
            path: `Models/${groupFileName}`,
            content: structs.join('\n'),
            sourceMapping: groupKey,
            confidence,
            warnings,
        });
    }

    return files;
}
