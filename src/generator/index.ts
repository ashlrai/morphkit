// Morphkit Generator — Public API
// Re-exports all generator modules and provides the main entry point

export type { GeneratedFile } from './swiftui-generator';
export type { GeneratedProject } from './project-generator';

export { generateSwiftUIViews } from './swiftui-generator';
export { generateSwiftModels } from './model-generator';
export { generateNavigation } from './navigation-generator';
export { generateNetworkingLayer } from './networking-generator';
export { generateXcodeProject } from './project-generator';

// Convenience re-exports of helpers used across generators
export { mapTsTypeToSwift, pascalCase, camelCase } from './swiftui-generator';

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

import type { SemanticAppModel } from '../semantic/model';
import type { GeneratedProject } from './project-generator';
import { generateXcodeProject } from './project-generator';

/**
 * Generate a complete SwiftUI Xcode project from a Semantic App Model.
 *
 * This is the primary entry point for the Morphkit generator pipeline.
 * It orchestrates all sub-generators (models, views, navigation, networking,
 * state, assets) and writes the output to disk.
 *
 * @param model  - The semantic app model produced by the analyzer stage.
 * @param outputPath - Directory where the project folder will be created.
 * @returns A manifest describing every generated file, confidence scores, and warnings.
 */
export async function generateProject(
    model: SemanticAppModel,
    outputPath: string,
): Promise<GeneratedProject> {
    return generateXcodeProject(model, outputPath);
}
