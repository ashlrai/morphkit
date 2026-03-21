/**
 * @module planner
 *
 * Intelligent mobile scope planner for Morphkit. Analyzes a semantic model
 * and recommends which screens to include in the iOS app, estimates complexity,
 * and produces a comprehensive markdown plan.
 */

import type { SemanticAppModel, Screen, BackendIntegration } from './semantic/model.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MobileWorthiness = 'essential' | 'recommended' | 'optional' | 'skip';
export type Complexity = 'low' | 'medium' | 'high';

export interface ScreenPlan {
    name: string;
    mobileWorthiness: MobileWorthiness;
    reason: string;
    complexity: Complexity;
    complexityReason: string;
    sourceFile: string;
    layout: string;
}

export interface ExcludedScreen {
    name: string;
    reason: string;
}

export interface IntegrationPlan {
    kind: string;
    swiftPackage: string;
    description: string;
}

export interface PlanResult {
    appName: string;
    screens: ScreenPlan[];
    excludedScreens: ExcludedScreen[];
    integrations: IntegrationPlan[];
    sseEndpointCount: number;
    hasMarkdownRendering: boolean;
    navigation: string;
    totalScreens: number;
    includedScreens: number;
    markdownPlan: string;
}

// ---------------------------------------------------------------------------
// Screen scoring
// ---------------------------------------------------------------------------

const SKIP_PATTERNS = [
    /^(landing|home|hero|marketing)/i,
    /^(blog|post|article)/i,
    /^(privacy|terms|tos|legal|cookie)/i,
    /^(about|contact|careers|jobs)/i,
    /^(enterprise|demo|pricing)$/i,
    /^(faq|help|support)$/i,
    /^(sitemap|robots|rss)/i,
    /^(admin|superadmin)/i,
    /^(api|webhook|cron)/i,
    /^(share|embed|widget)/i,
    /^(reset-?password|forgot-?password|verify-?email|confirm)/i,
];

const ESSENTIAL_PATTERNS = [
    /^(dashboard|home|main|index)/i,
    /^(login|signin|register|signup|auth)/i,
    /^(profile|account|settings)/i,
    /^(search|explore|discover)/i,
];

function scoreMobileWorthiness(screen: Screen): { worthiness: MobileWorthiness; reason: string } {
    const name = screen.name;
    const nameLower = name.toLowerCase();

    // Skip patterns
    for (const pattern of SKIP_PATTERNS) {
        if (pattern.test(name)) {
            return { worthiness: 'skip', reason: `${name} is a web-only page (marketing/SEO/admin)` };
        }
    }

    // Essential patterns
    for (const pattern of ESSENTIAL_PATTERNS) {
        if (pattern.test(name)) {
            return { worthiness: 'essential', reason: `${name} is a core mobile screen` };
        }
    }

    // Detail/list screens are recommended
    if (screen.layout === 'detail' || screen.layout === 'list' || screen.layout === 'grid') {
        return { worthiness: 'recommended', reason: `${screen.layout} layout maps well to mobile` };
    }

    // Form screens are recommended
    if (screen.layout === 'form') {
        return { worthiness: 'recommended', reason: 'Form screens work well on mobile' };
    }

    // Settings/profile layouts are essential
    if (screen.layout === 'settings' || screen.layout === 'profile') {
        return { worthiness: 'essential', reason: `${screen.layout} is expected on mobile` };
    }

    // Screens with data requirements are recommended
    if ((screen.dataRequirements ?? []).length > 0) {
        return { worthiness: 'recommended', reason: 'Has data requirements (API-connected)' };
    }

    // Team/billing/admin screens are optional
    if (nameLower.includes('team') || nameLower.includes('billing') || nameLower.includes('admin')) {
        return { worthiness: 'optional', reason: 'Admin/billing features can stay web-only for v1' };
    }

    // Custom layout without data requirements → optional
    if ((screen.dataRequirements ?? []).length === 0 && (screen.components ?? []).length <= 1) {
        return { worthiness: 'skip', reason: 'Static content with no data requirements' };
    }

    return { worthiness: 'recommended', reason: 'General app screen' };
}

function scoreComplexity(screen: Screen, model: SemanticAppModel): { complexity: Complexity; reason: string } {
    const dataReqs = screen.dataRequirements ?? [];
    const actions = screen.actions ?? [];
    const stateBindings = screen.stateBindings ?? [];
    const components = screen.components ?? [];

    // Check for SSE streaming endpoints
    const sseEndpoints = (model.apiEndpoints ?? []).filter(ep =>
        ep.streaming?.type === 'sse' &&
        dataReqs.some(req => {
            const source = (req.source ?? '').toLowerCase();
            return ep.url.toLowerCase().includes(source) || source.includes(ep.url.toLowerCase().replace('/api/', ''));
        })
    );
    if (sseEndpoints.length > 0) {
        return { complexity: 'high', reason: 'SSE streaming endpoint — requires AsyncStream pattern' };
    }

    // Payment/billing screens are high complexity
    const nameLower = screen.name.toLowerCase();
    if (nameLower.includes('billing') || nameLower.includes('payment') || nameLower.includes('checkout')) {
        return { complexity: 'high', reason: 'Payment integration — requires Stripe WebView' };
    }

    // Many data requirements + actions = medium-high
    if (dataReqs.length >= 3 || actions.length >= 4) {
        return { complexity: 'medium', reason: `${dataReqs.length} data requirements, ${actions.length} actions` };
    }

    // Many state bindings = medium
    if (stateBindings.length >= 5 || components.length >= 6) {
        return { complexity: 'medium', reason: `Complex state (${stateBindings.length} bindings, ${components.length} components)` };
    }

    return { complexity: 'low', reason: 'Standard CRUD screen' };
}

// ---------------------------------------------------------------------------
// Integration planning
// ---------------------------------------------------------------------------

function planIntegrations(model: SemanticAppModel): IntegrationPlan[] {
    const plans: IntegrationPlan[] = [];
    const integrations = model.backendIntegrations ?? [];

    for (const int of integrations) {
        switch (int.kind) {
            case 'supabase':
                plans.push({
                    kind: 'supabase',
                    swiftPackage: 'supabase-swift',
                    description: `Supabase Swift SDK (features: ${int.features.join(', ')}) — auth, database queries, realtime`,
                });
                break;
            case 'stripe':
                plans.push({
                    kind: 'stripe',
                    swiftPackage: 'WKWebView (built-in)',
                    description: 'Stripe Checkout via WKWebView — opens payment page in-app',
                });
                break;
            case 'firebase':
                plans.push({
                    kind: 'firebase',
                    swiftPackage: 'firebase-ios-sdk',
                    description: `Firebase iOS SDK (features: ${int.features.join(', ')})`,
                });
                break;
            case 'markdown':
                plans.push({
                    kind: 'markdown',
                    swiftPackage: 'swift-markdown-ui',
                    description: 'MarkdownUI for rendering markdown content',
                });
                break;
            default:
                if (int.kind !== 'openai' && int.kind !== 'anthropic') {
                    plans.push({
                        kind: int.kind,
                        swiftPackage: 'custom',
                        description: `${int.sdkPackage} — requires custom integration`,
                    });
                }
        }
    }

    // SSE streaming
    const sseCount = (model.apiEndpoints ?? []).filter(ep => ep.streaming?.type === 'sse').length;
    if (sseCount > 0) {
        plans.push({
            kind: 'sse',
            swiftPackage: 'URLSession (built-in)',
            description: `${sseCount} SSE streaming endpoint${sseCount > 1 ? 's' : ''} — URLSession AsyncBytes`,
        });
    }

    return plans;
}

// ---------------------------------------------------------------------------
// Markdown plan generation
// ---------------------------------------------------------------------------

function generateMarkdownPlan(result: Omit<PlanResult, 'markdownPlan'>): string {
    const lines: string[] = [];

    lines.push(`# iOS Conversion Plan: ${result.appName}`);
    lines.push('');
    lines.push(`*Generated by Morphkit*`);
    lines.push('');

    // Detected stack
    lines.push('## Detected Stack');
    lines.push('');
    if (result.integrations.length === 0) {
        lines.push('No special backend integrations detected — using standard URLSession.');
    } else {
        for (const int of result.integrations) {
            lines.push(`- **${int.kind}** (${int.swiftPackage}) — ${int.description}`);
        }
    }
    lines.push('');

    // Summary
    lines.push('## Summary');
    lines.push('');
    lines.push(`| Metric | Value |`);
    lines.push(`|--------|-------|`);
    lines.push(`| Total screens analyzed | ${result.totalScreens} |`);
    lines.push(`| Screens included | ${result.includedScreens} |`);
    lines.push(`| Screens excluded | ${result.excludedScreens.length} |`);
    lines.push(`| SSE streaming endpoints | ${result.sseEndpointCount} |`);
    lines.push(`| Markdown rendering | ${result.hasMarkdownRendering ? 'Yes (MarkdownUI)' : 'No'} |`);
    lines.push(`| Navigation | ${result.navigation} |`);
    lines.push('');

    // Included screens grouped by worthiness
    const essential = result.screens.filter(s => s.mobileWorthiness === 'essential');
    const recommended = result.screens.filter(s => s.mobileWorthiness === 'recommended');
    const optional = result.screens.filter(s => s.mobileWorthiness === 'optional');

    if (essential.length > 0) {
        lines.push('## Essential Screens');
        lines.push('');
        for (const s of essential) {
            const complexityBadge = s.complexity === 'high' ? ' **[HIGH]**' : s.complexity === 'medium' ? ' [MEDIUM]' : '';
            lines.push(`- **${s.name}** (${s.layout})${complexityBadge} — ${s.reason}`);
            if (s.complexity !== 'low') lines.push(`  - Complexity: ${s.complexityReason}`);
        }
        lines.push('');
    }

    if (recommended.length > 0) {
        lines.push('## Recommended Screens');
        lines.push('');
        for (const s of recommended) {
            const complexityBadge = s.complexity === 'high' ? ' **[HIGH]**' : s.complexity === 'medium' ? ' [MEDIUM]' : '';
            lines.push(`- **${s.name}** (${s.layout})${complexityBadge} — ${s.reason}`);
            if (s.complexity !== 'low') lines.push(`  - Complexity: ${s.complexityReason}`);
        }
        lines.push('');
    }

    if (optional.length > 0) {
        lines.push('## Optional Screens (v2)');
        lines.push('');
        for (const s of optional) {
            lines.push(`- ${s.name} — ${s.reason}`);
        }
        lines.push('');
    }

    // Excluded screens
    if (result.excludedScreens.length > 0) {
        lines.push('## Excluded Screens');
        lines.push('');
        for (const s of result.excludedScreens) {
            lines.push(`- ~~${s.name}~~ — ${s.reason}`);
        }
        lines.push('');
    }

    // Next steps
    lines.push('## Next Steps');
    lines.push('');
    lines.push('```bash');
    lines.push(`# Generate the iOS project`);
    lines.push(`morphkit generate ./ -o ./ios-app -n ${result.appName.replace(/\s+/g, '')}`);
    lines.push('');
    lines.push('# Auto-complete TODOs with AI');
    lines.push('morphkit complete ./ios-app');
    lines.push('');
    lines.push('# Verify completion');
    lines.push('morphkit verify ./ios-app');
    lines.push('```');
    lines.push('');

    return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function generatePlan(model: SemanticAppModel): PlanResult {
    const screens: ScreenPlan[] = [];
    const excludedScreens: ExcludedScreen[] = [];

    for (const screen of model.screens ?? []) {
        const { worthiness, reason } = scoreMobileWorthiness(screen);
        const { complexity, reason: complexityReason } = scoreComplexity(screen, model);

        if (worthiness === 'skip') {
            excludedScreens.push({ name: screen.name, reason });
        } else {
            screens.push({
                name: screen.name,
                mobileWorthiness: worthiness,
                reason,
                complexity,
                complexityReason,
                sourceFile: screen.sourceFile ?? '',
                layout: screen.layout ?? 'custom',
            });
        }
    }

    // Sort: essential first, then recommended, then optional
    const order: Record<MobileWorthiness, number> = { essential: 0, recommended: 1, optional: 2, skip: 3 };
    screens.sort((a, b) => order[a.mobileWorthiness] - order[b.mobileWorthiness]);

    const integrations = planIntegrations(model);
    const sseEndpointCount = (model.apiEndpoints ?? []).filter(ep => ep.streaming?.type === 'sse').length;

    const result: Omit<PlanResult, 'markdownPlan'> = {
        appName: model.appName ?? 'MyApp',
        screens,
        excludedScreens,
        integrations,
        sseEndpointCount,
        hasMarkdownRendering: model.hasMarkdownRendering ?? false,
        navigation: model.navigation?.type ?? 'mixed',
        totalScreens: (model.screens ?? []).length,
        includedScreens: screens.length,
    };

    return {
        ...result,
        markdownPlan: generateMarkdownPlan(result),
    };
}
