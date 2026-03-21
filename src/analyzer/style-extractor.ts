/**
 * @module analyzer/style-extractor
 *
 * Extracts Tailwind CSS utility classes from JSX/TSX files and maps them
 * to SwiftUI modifiers. Used by the view generator for visual fidelity.
 */

export interface ExtractedStyles {
    /** Component or element tag name */
    element: string;
    /** Tailwind classes found on this element */
    classes: string[];
    /** Mapped SwiftUI modifiers */
    swiftUIModifiers: string[];
}

export interface StyleExtractionResult {
    /** Styles grouped by file */
    fileStyles: Map<string, ExtractedStyles[]>;
    /** Common Tailwind classes used across the project (frequency > 1) */
    commonClasses: Map<string, number>;
}

// Map of Tailwind utility → SwiftUI modifier
const TAILWIND_TO_SWIFTUI: Record<string, string> = {
    // Text sizes
    'text-xs': '.font(.caption2)',
    'text-sm': '.font(.caption)',
    'text-base': '.font(.body)',
    'text-lg': '.font(.title3)',
    'text-xl': '.font(.title2)',
    'text-2xl': '.font(.title)',
    'text-3xl': '.font(.largeTitle)',

    // Font weights
    'font-thin': '.fontWeight(.thin)',
    'font-light': '.fontWeight(.light)',
    'font-normal': '.fontWeight(.regular)',
    'font-medium': '.fontWeight(.medium)',
    'font-semibold': '.fontWeight(.semibold)',
    'font-bold': '.fontWeight(.bold)',
    'font-extrabold': '.fontWeight(.heavy)',

    // Text colors (map to system colors)
    'text-gray-500': '.foregroundStyle(.secondary)',
    'text-gray-600': '.foregroundStyle(.secondary)',
    'text-gray-400': '.foregroundStyle(.tertiary)',
    'text-red-500': '.foregroundStyle(.red)',
    'text-red-600': '.foregroundStyle(.red)',
    'text-blue-500': '.foregroundStyle(.blue)',
    'text-blue-600': '.foregroundStyle(.blue)',
    'text-green-500': '.foregroundStyle(.green)',
    'text-green-600': '.foregroundStyle(.green)',
    'text-white': '.foregroundStyle(.white)',

    // Padding
    'p-1': '.padding(4)',
    'p-2': '.padding(8)',
    'p-3': '.padding(12)',
    'p-4': '.padding(16)',
    'p-5': '.padding(20)',
    'p-6': '.padding(24)',
    'p-8': '.padding(32)',
    'px-2': '.padding(.horizontal, 8)',
    'px-3': '.padding(.horizontal, 12)',
    'px-4': '.padding(.horizontal, 16)',
    'px-6': '.padding(.horizontal, 24)',
    'py-1': '.padding(.vertical, 4)',
    'py-2': '.padding(.vertical, 8)',
    'py-3': '.padding(.vertical, 12)',
    'py-4': '.padding(.vertical, 16)',

    // Rounded corners
    'rounded': '.clipShape(RoundedRectangle(cornerRadius: 4))',
    'rounded-md': '.clipShape(RoundedRectangle(cornerRadius: 6))',
    'rounded-lg': '.clipShape(RoundedRectangle(cornerRadius: 8))',
    'rounded-xl': '.clipShape(RoundedRectangle(cornerRadius: 12))',
    'rounded-2xl': '.clipShape(RoundedRectangle(cornerRadius: 16))',
    'rounded-full': '.clipShape(Circle())',

    // Background colors
    'bg-white': '.background(Color.white)',
    'bg-gray-50': '.background(Color(.systemGray6))',
    'bg-gray-100': '.background(Color(.systemGray5))',
    'bg-gray-200': '.background(Color(.systemGray4))',
    'bg-red-50': '.background(Color.red.opacity(0.1))',
    'bg-blue-50': '.background(Color.blue.opacity(0.1))',
    'bg-green-50': '.background(Color.green.opacity(0.1))',

    // Layout
    'w-full': '.frame(maxWidth: .infinity)',
    'h-full': '.frame(maxHeight: .infinity)',
    'hidden': '', // Skip hidden elements

    // Opacity
    'opacity-50': '.opacity(0.5)',
    'opacity-75': '.opacity(0.75)',

    // Alignment
    'text-center': '.multilineTextAlignment(.center)',
    'text-right': '.multilineTextAlignment(.trailing)',
    'text-left': '.multilineTextAlignment(.leading)',
};

/**
 * Extract className attributes from JSX/TSX content and map to SwiftUI modifiers.
 */
export function extractStylesFromSource(source: string): ExtractedStyles[] {
    const styles: ExtractedStyles[] = [];

    // Match className="..." or className={`...`} or className={'...'}
    const classNameRe = /className\s*=\s*(?:"([^"]+)"|{`([^`]+)`}|{'([^']+)'})/g;
    let match: RegExpExecArray | null;

    while ((match = classNameRe.exec(source)) !== null) {
        const classString = match[1] ?? match[2] ?? match[3] ?? '';
        const classes = classString.split(/\s+/).filter(c => c && !c.includes('$'));

        const swiftUIModifiers: string[] = [];
        for (const cls of classes) {
            const modifier = TAILWIND_TO_SWIFTUI[cls];
            if (modifier) {
                swiftUIModifiers.push(modifier);
            }
        }

        if (swiftUIModifiers.length > 0) {
            // Try to find the element tag name
            const beforeMatch = source.substring(Math.max(0, match.index - 100), match.index);
            const tagMatch = beforeMatch.match(/<(\w+)[^>]*$/);
            const element = tagMatch ? tagMatch[1] : 'unknown';

            styles.push({ element, classes, swiftUIModifiers });
        }
    }

    return styles;
}

/**
 * Extract spacing value from Tailwind gap class.
 * Returns SwiftUI spacing value or null.
 */
export function extractGapSpacing(classes: string[]): number | null {
    for (const cls of classes) {
        const gapMatch = cls.match(/^gap-(\d+)$/);
        if (gapMatch) {
            return parseInt(gapMatch[1], 10) * 4; // Tailwind spacing scale: 1 = 4px
        }
    }
    return null;
}
