/**
 * Model Diffing — compares two SemanticAppModels to determine what changed.
 *
 * Used by the sync engine to generate targeted updates instead of
 * regenerating the entire iOS project on every web app change.
 */

import type { SemanticAppModel, Entity, Screen, ApiEndpoint, Field } from '../semantic/model.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ModelDiff {
  addedScreens: string[];
  removedScreens: string[];
  modifiedScreens: string[];

  addedEntities: string[];
  removedEntities: string[];
  modifiedEntities: string[];

  addedEndpoints: string[];
  removedEndpoints: string[];
  modifiedEndpoints: string[];

  changedNavigation: boolean;
  changedAuth: boolean;

  /** Human-readable summary suitable for PR descriptions */
  summary: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fieldSignature(f: Field): string {
  return `${f.name}:${f.type.kind}${f.optional ? '?' : ''}`;
}

function screenSignature(s: Screen): string {
  const parts = [
    s.layout,
    s.dataRequirements.map(d => `${d.source}:${d.fetchStrategy}:${d.cardinality}`).sort().join(','),
    s.actions.map(a => `${a.label}:${a.effect.type}:${a.effect.target}`).sort().join(','),
    s.stateBindings.slice().sort().join(','),
    s.components.map(c => `${c.name}:${c.count}`).sort().join(','),
  ];
  return parts.join('|');
}

function entitySignature(e: Entity): string {
  return e.fields.map(fieldSignature).sort().join(',');
}

function endpointKey(ep: ApiEndpoint): string {
  return `${ep.method}:${ep.url}`;
}

function endpointSignature(ep: ApiEndpoint): string {
  const parts = [
    ep.method,
    ep.url,
    ep.responseType.kind,
    ep.requestBody ? ep.requestBody.kind : 'null',
    ep.auth ? 'auth' : 'noauth',
  ];
  return parts.join('|');
}

function navigationSignature(model: SemanticAppModel): string {
  const nav = model.navigation;
  const parts = [
    nav.type,
    nav.initialScreen,
    nav.routes.map(r => `${r.path}:${r.screen}`).sort().join(','),
    nav.tabs.map(t => `${t.label}:${t.screen}`).sort().join(','),
  ];
  return parts.join('|');
}

function authSignature(model: SemanticAppModel): string {
  if (!model.auth) return 'none';
  const a = model.auth;
  return [
    a.type,
    a.provider ?? '',
    a.storageStrategy,
    a.flows.map(f => `${f.name}:${f.screens.join('+')}`).sort().join(','),
  ].join('|');
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/**
 * Compare two SemanticAppModels and produce a structured diff.
 *
 * Screens, entities, and endpoints are compared by name.
 * A "modification" is detected when the element exists in both models
 * but its signature (a hash of its meaningful properties) differs.
 */
export function diffModels(prev: SemanticAppModel, next: SemanticAppModel): ModelDiff {
  // --- Screens ---
  const prevScreens = new Map(prev.screens.map(s => [s.name, s]));
  const nextScreens = new Map(next.screens.map(s => [s.name, s]));

  const addedScreens = next.screens.filter(s => !prevScreens.has(s.name)).map(s => s.name);
  const removedScreens = prev.screens.filter(s => !nextScreens.has(s.name)).map(s => s.name);
  const modifiedScreens: string[] = [];
  for (const [name, nextScreen] of nextScreens) {
    const prevScreen = prevScreens.get(name);
    if (prevScreen && screenSignature(prevScreen) !== screenSignature(nextScreen)) {
      modifiedScreens.push(name);
    }
  }

  // --- Entities ---
  const prevEntities = new Map(prev.entities.map(e => [e.name, e]));
  const nextEntities = new Map(next.entities.map(e => [e.name, e]));

  const addedEntities = next.entities.filter(e => !prevEntities.has(e.name)).map(e => e.name);
  const removedEntities = prev.entities.filter(e => !nextEntities.has(e.name)).map(e => e.name);
  const modifiedEntities: string[] = [];
  for (const [name, nextEntity] of nextEntities) {
    const prevEntity = prevEntities.get(name);
    if (prevEntity && entitySignature(prevEntity) !== entitySignature(nextEntity)) {
      modifiedEntities.push(name);
    }
  }

  // --- Endpoints ---
  const prevEndpoints = new Map(prev.apiEndpoints.map(ep => [endpointKey(ep), ep]));
  const nextEndpoints = new Map(next.apiEndpoints.map(ep => [endpointKey(ep), ep]));

  const addedEndpoints = next.apiEndpoints
    .filter(ep => !prevEndpoints.has(endpointKey(ep)))
    .map(ep => endpointKey(ep));
  const removedEndpoints = prev.apiEndpoints
    .filter(ep => !nextEndpoints.has(endpointKey(ep)))
    .map(ep => endpointKey(ep));
  const modifiedEndpoints: string[] = [];
  for (const [key, nextEp] of nextEndpoints) {
    const prevEp = prevEndpoints.get(key);
    if (prevEp && endpointSignature(prevEp) !== endpointSignature(nextEp)) {
      modifiedEndpoints.push(key);
    }
  }

  // --- Navigation & Auth ---
  const changedNavigation = navigationSignature(prev) !== navigationSignature(next);
  const changedAuth = authSignature(prev) !== authSignature(next);

  // --- Summary ---
  const summary = buildSummary({
    addedScreens,
    removedScreens,
    modifiedScreens,
    addedEntities,
    removedEntities,
    modifiedEntities,
    addedEndpoints,
    removedEndpoints,
    modifiedEndpoints,
    changedNavigation,
    changedAuth,
  });

  return {
    addedScreens,
    removedScreens,
    modifiedScreens,
    addedEntities,
    removedEntities,
    modifiedEntities,
    addedEndpoints,
    removedEndpoints,
    modifiedEndpoints,
    changedNavigation,
    changedAuth,
    summary,
  };
}

/**
 * Returns true when the diff contains zero changes.
 */
export function isDiffEmpty(diff: ModelDiff): boolean {
  return (
    diff.addedScreens.length === 0 &&
    diff.removedScreens.length === 0 &&
    diff.modifiedScreens.length === 0 &&
    diff.addedEntities.length === 0 &&
    diff.removedEntities.length === 0 &&
    diff.modifiedEntities.length === 0 &&
    diff.addedEndpoints.length === 0 &&
    diff.removedEndpoints.length === 0 &&
    diff.modifiedEndpoints.length === 0 &&
    !diff.changedNavigation &&
    !diff.changedAuth
  );
}

// ---------------------------------------------------------------------------
// Summary builder
// ---------------------------------------------------------------------------

function buildSummary(diff: Omit<ModelDiff, 'summary'>): string {
  const parts: string[] = [];

  const screenChanges = diff.addedScreens.length + diff.removedScreens.length + diff.modifiedScreens.length;
  const entityChanges = diff.addedEntities.length + diff.removedEntities.length + diff.modifiedEntities.length;
  const endpointChanges = diff.addedEndpoints.length + diff.removedEndpoints.length + diff.modifiedEndpoints.length;

  if (screenChanges === 0 && entityChanges === 0 && endpointChanges === 0 && !diff.changedNavigation && !diff.changedAuth) {
    return 'No changes detected';
  }

  if (diff.addedScreens.length > 0) {
    parts.push(`${diff.addedScreens.length} new screen${diff.addedScreens.length === 1 ? '' : 's'}`);
  }
  if (diff.removedScreens.length > 0) {
    parts.push(`${diff.removedScreens.length} removed screen${diff.removedScreens.length === 1 ? '' : 's'}`);
  }
  if (diff.modifiedScreens.length > 0) {
    parts.push(`${diff.modifiedScreens.length} updated screen${diff.modifiedScreens.length === 1 ? '' : 's'}`);
  }

  if (diff.addedEntities.length > 0) {
    parts.push(`${diff.addedEntities.length} new entit${diff.addedEntities.length === 1 ? 'y' : 'ies'}`);
  }
  if (diff.removedEntities.length > 0) {
    parts.push(`${diff.removedEntities.length} removed entit${diff.removedEntities.length === 1 ? 'y' : 'ies'}`);
  }
  if (diff.modifiedEntities.length > 0) {
    parts.push(`${diff.modifiedEntities.length} updated entit${diff.modifiedEntities.length === 1 ? 'y' : 'ies'}`);
  }

  if (diff.addedEndpoints.length > 0) {
    parts.push(`${diff.addedEndpoints.length} new endpoint${diff.addedEndpoints.length === 1 ? '' : 's'}`);
  }
  if (diff.removedEndpoints.length > 0) {
    parts.push(`${diff.removedEndpoints.length} removed endpoint${diff.removedEndpoints.length === 1 ? '' : 's'}`);
  }
  if (diff.modifiedEndpoints.length > 0) {
    parts.push(`${diff.modifiedEndpoints.length} updated endpoint${diff.modifiedEndpoints.length === 1 ? '' : 's'}`);
  }

  if (diff.changedNavigation) {
    parts.push('navigation updated');
  }
  if (diff.changedAuth) {
    parts.push('auth updated');
  }

  return parts.join(', ');
}
