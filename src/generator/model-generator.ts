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
import { mapTsTypeToSwift, typeDefToSwift, pascalCase, camelCase, indent, relativeSourcePath } from './swiftui-generator';

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
    needsCodingKey: boolean;
    defaultValue?: string;
    comment?: string;
}

/**
 * Convert a TypeDefinition to a raw string representation for mapTsTypeToSwift,
 * or use typeDefToSwift directly for structured types.
 */
function typeDefinitionToSwiftType(td: TypeDefinition): string {
    return typeDefToSwift(td);
}

function analyseField(field: Field): SwiftField {
    const name = camelCase(field.name);
    const originalName = field.name;
    const needsCodingKey = name !== originalName;

    const td: TypeDefinition = field.type;
    let isOptional = field.optional === true;
    let isArray = td.kind === 'array';

    let swiftType = typeDefinitionToSwiftType(td);

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

    return {
        name,
        type: swiftType,
        originalName,
        isOptional,
        isArray,
        isId,
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

/**
 * Convert a kebab-case or arbitrary string value to a valid Swift camelCase
 * enum case name.  e.g. 'price-asc' → 'priceAsc', 'name' → 'name'
 */
function enumCaseName(value: string): string {
    // Split on hyphens, underscores, spaces
    const parts = value.split(/[-_ ]+/);
    if (parts.length === 1) return parts[0];
    return parts[0] + parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
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
// Struct generation
// ---------------------------------------------------------------------------

function generateStruct(entity: Entity, model: SemanticAppModel): string {
    const structName = pascalCase(entity.name);
    const fields = (entity.fields ?? []).map(analyseField);
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

export function generateSwiftModels(model: SemanticAppModel): GeneratedFile[] {
    const files: GeneratedFile[] = [];
    const entities = model.entities ?? [];

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

        for (const entity of groupEntities) {
            if (isEnumEntity(entity)) {
                structs.push(generateEnum(entity));
            } else {
                structs.push(generateStruct(entity, model));
            }
            structs.push('');

            // Validate
            const fields = entity.fields ?? [];
            if (fields.length === 0) {
                warnings.push(`Entity "${entity.name}" has no fields`);
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
