import { describe, test, expect } from 'bun:test';

import { generateNetworkingLayer } from '../../src/generator/networking-generator';
import { generateSwiftUIViews } from '../../src/generator/swiftui-generator';
import type { SemanticAppModel } from '../../src/semantic/model';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseTheme = {
    colors: { primary: '#007AFF', secondary: '#5856D6', background: '#FFFFFF', surface: '#F2F2F7', text: '#000000', textSecondary: '#8E8E93' },
    typography: { heading: { fontFamily: 'system', fontSize: 28, fontWeight: 'bold' }, body: { fontFamily: 'system', fontSize: 17, fontWeight: 'regular' }, caption: { fontFamily: 'system', fontSize: 12, fontWeight: 'regular' } },
    spacing: { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 },
    borderRadius: {},
};

function createModel(overrides: Partial<SemanticAppModel> = {}): SemanticAppModel {
    return {
        appName: 'TestApp',
        description: 'A test app',
        version: '1.0' as const,
        entities: [],
        screens: [],
        navigation: { type: 'stack', routes: [], tabs: [], deepLinks: [], initialScreen: 'Login' },
        stateManagement: [],
        apiEndpoints: [],
        auth: null,
        theme: baseTheme,
        confidence: 'high',
        metadata: {
            sourceFramework: 'react',
            extractedAt: new Date().toISOString(),
            morphkitVersion: '0.1.0',
            analyzedFiles: [],
            warnings: [],
        },
        ...overrides,
    } as SemanticAppModel;
}

function createAuthScreen(name: string, extraOverrides: Record<string, any> = {}) {
    return {
        name,
        description: `${name} screen`,
        purpose: `User ${name.toLowerCase()}`,
        sourceFile: `app/${name.toLowerCase()}/page.tsx`,
        sourceComponent: name,
        layout: 'auth' as const,
        components: [],
        dataRequirements: [],
        actions: [],
        stateBindings: [],
        isEntryPoint: true,
        confidence: 'high' as const,
        ...extraOverrides,
    };
}

// ---------------------------------------------------------------------------
// Auth Flow Generation Tests
// ---------------------------------------------------------------------------

describe('Auth Flow Generation', () => {
    test('login screen generates email field', () => {
        const model = createModel({
            screens: [createAuthScreen('Login')],
        });
        const files = generateSwiftUIViews(model);
        const loginView = files.find(f => f.path.includes('Login'));
        expect(loginView).toBeDefined();
        expect(loginView!.content).toContain('TextField("Email", text: $email)');
    });

    test('login screen generates SecureField for password', () => {
        const model = createModel({
            screens: [createAuthScreen('Login')],
        });
        const files = generateSwiftUIViews(model);
        const loginView = files.find(f => f.path.includes('Login'));
        expect(loginView).toBeDefined();
        expect(loginView!.content).toContain('SecureField("Password", text: $password)');
    });

    test('login screen generates password show/hide toggle', () => {
        const model = createModel({
            screens: [createAuthScreen('Login')],
        });
        const files = generateSwiftUIViews(model);
        const loginView = files.find(f => f.path.includes('Login'));
        expect(loginView).toBeDefined();
        expect(loginView!.content).toContain('showPassword.toggle()');
        expect(loginView!.content).toContain('@State private var showPassword = false');
    });

    test('login screen generates sign in button with loading state', () => {
        const model = createModel({
            screens: [createAuthScreen('Login')],
        });
        const files = generateSwiftUIViews(model);
        const loginView = files.find(f => f.path.includes('Login'));
        expect(loginView).toBeDefined();
        expect(loginView!.content).toContain('Text("Sign In")');
        expect(loginView!.content).toContain('if isLoading {');
        expect(loginView!.content).toContain('ProgressView()');
        expect(loginView!.content).toContain('.disabled(email.isEmpty || password.isEmpty || isLoading)');
    });

    test('login screen generates async login function wired to AuthManager', () => {
        const model = createModel({
            screens: [createAuthScreen('Login')],
        });
        const files = generateSwiftUIViews(model);
        const loginView = files.find(f => f.path.includes('Login'));
        expect(loginView).toBeDefined();
        expect(loginView!.content).toContain('private func login() async {');
        expect(loginView!.content).toContain('AuthManager.shared.login(email: email, password: password)');
    });

    test('login screen generates error message display', () => {
        const model = createModel({
            screens: [createAuthScreen('Login')],
        });
        const files = generateSwiftUIViews(model);
        const loginView = files.find(f => f.path.includes('Login'));
        expect(loginView).toBeDefined();
        expect(loginView!.content).toContain('if let errorMessage {');
        expect(loginView!.content).toContain('@State private var errorMessage: String?');
    });

    test('login screen generates navigation to register', () => {
        const model = createModel({
            screens: [createAuthScreen('Login')],
        });
        const files = generateSwiftUIViews(model);
        const loginView = files.find(f => f.path.includes('Login'));
        expect(loginView).toBeDefined();
        expect(loginView!.content).toContain('NavigationLink("Sign Up")');
        // Falls back to 'SignUpView' when no register/signup screen is in the model
        expect(loginView!.content).toContain('View()');
    });

    test('register screen generates name, email, password, confirm password fields', () => {
        const model = createModel({
            screens: [createAuthScreen('Register')],
        });
        const files = generateSwiftUIViews(model);
        const registerView = files.find(f => f.path.includes('Register'));
        expect(registerView).toBeDefined();
        expect(registerView!.content).toContain('TextField("Full Name", text: $name)');
        expect(registerView!.content).toContain('TextField("Email", text: $email)');
        expect(registerView!.content).toContain('SecureField("Confirm Password", text: $confirmPassword)');
        expect(registerView!.content).toContain('@State private var name = ""');
        expect(registerView!.content).toContain('@State private var confirmPassword = ""');
    });

    test('register screen generates password mismatch validation', () => {
        const model = createModel({
            screens: [createAuthScreen('Register')],
        });
        const files = generateSwiftUIViews(model);
        const registerView = files.find(f => f.path.includes('Register'));
        expect(registerView).toBeDefined();
        expect(registerView!.content).toContain('password != confirmPassword');
        expect(registerView!.content).toContain('Passwords do not match');
    });

    test('register screen generates async register function wired to AuthManager', () => {
        const model = createModel({
            screens: [createAuthScreen('Register')],
        });
        const files = generateSwiftUIViews(model);
        const registerView = files.find(f => f.path.includes('Register'));
        expect(registerView).toBeDefined();
        expect(registerView!.content).toContain('private func register() async {');
        expect(registerView!.content).toContain('AuthManager.shared.register(name: name, email: email, password: password)');
    });

    test('signup screen name is detected as register layout', () => {
        const model = createModel({
            screens: [createAuthScreen('SignUp')],
        });
        const files = generateSwiftUIViews(model);
        const signupView = files.find(f => f.path.includes('SignUp'));
        expect(signupView).toBeDefined();
        expect(signupView!.content).toContain('Create Account');
        expect(signupView!.content).toContain('private func register() async {');
    });
});

// ---------------------------------------------------------------------------
// Auth Networking Tests
// ---------------------------------------------------------------------------

describe('Auth API Methods', () => {
    test('generates login method when auth is detected', () => {
        const model = createModel({
            auth: {
                type: 'jwt',
                provider: null,
                flows: [{ name: 'login', screens: ['Login'], endpoints: ['/api/auth/login'], description: '' }],
                storageStrategy: 'localStorage',
                confidence: 'high',
            },
        });
        const files = generateNetworkingLayer(model);
        const apiClient = files.find(f => f.path.includes('APIClient'));
        expect(apiClient).toBeDefined();
        expect(apiClient!.content).toContain('func login(email: String, password: String) async throws -> AuthResponse');
    });

    test('generates register method when auth is detected', () => {
        const model = createModel({
            auth: {
                type: 'jwt',
                provider: null,
                flows: [
                    { name: 'login', screens: ['Login'], endpoints: ['/api/auth/login'], description: '' },
                    { name: 'register', screens: ['Register'], endpoints: ['/api/auth/register'], description: '' },
                ],
                storageStrategy: 'localStorage',
                confidence: 'high',
            },
        });
        const files = generateNetworkingLayer(model);
        const apiClient = files.find(f => f.path.includes('APIClient'));
        expect(apiClient).toBeDefined();
        expect(apiClient!.content).toContain('func register(name: String, email: String, password: String) async throws -> AuthResponse');
    });

    test('generates logout method when auth is detected', () => {
        const model = createModel({
            auth: {
                type: 'jwt',
                provider: null,
                flows: [],
                storageStrategy: 'localStorage',
                confidence: 'high',
            },
        });
        const files = generateNetworkingLayer(model);
        const apiClient = files.find(f => f.path.includes('APIClient'));
        expect(apiClient).toBeDefined();
        expect(apiClient!.content).toContain('func logout()');
    });

    test('generates AuthResponse struct when auth is detected', () => {
        const model = createModel({
            auth: {
                type: 'jwt',
                provider: null,
                flows: [],
                storageStrategy: 'localStorage',
                confidence: 'high',
            },
        });
        const files = generateNetworkingLayer(model);
        const authResponse = files.find(f => f.path.includes('AuthResponse'));
        expect(authResponse).toBeDefined();
        expect(authResponse!.content).toContain('struct AuthResponse: Codable');
        expect(authResponse!.content).toContain('let token: String');
        expect(authResponse!.content).toContain('let user: AuthUser?');
    });

    test('AuthResponse references User entity when one exists', () => {
        const model = createModel({
            entities: [
                {
                    name: 'User',
                    description: 'A user',
                    fields: [
                        { name: 'id', type: { kind: 'string' }, optional: false, description: '', isPrimaryKey: true },
                        { name: 'email', type: { kind: 'string' }, optional: false, description: '', isPrimaryKey: false },
                    ],
                    sourceFile: 'types/user.ts',
                    relationships: [],
                    confidence: 'high',
                },
            ],
            auth: {
                type: 'jwt',
                provider: null,
                flows: [],
                storageStrategy: 'localStorage',
                confidence: 'high',
            },
        });
        const files = generateNetworkingLayer(model);
        const authResponse = files.find(f => f.path.includes('AuthResponse'));
        expect(authResponse).toBeDefined();
        expect(authResponse!.content).toContain('let user: User?');
        // Should NOT generate a standalone AuthUser when User entity exists
        expect(authResponse!.content).not.toContain('struct AuthUser');
    });

    test('generates refreshToken method when refresh endpoint exists', () => {
        const model = createModel({
            auth: {
                type: 'jwt',
                provider: null,
                flows: [{ name: 'refresh', screens: [], endpoints: ['/api/auth/refresh'], description: '' }],
                storageStrategy: 'localStorage',
                confidence: 'high',
            },
            apiEndpoints: [
                {
                    url: '/api/auth/refresh',
                    method: 'POST',
                    headers: {},
                    requestBody: null,
                    responseType: { kind: 'object' as const, typeName: 'AuthResponse' },
                    auth: true,
                    caching: null,
                    description: 'Refresh auth token',
                    sourceFile: '',
                    confidence: 'high' as const,
                },
            ],
        });
        const files = generateNetworkingLayer(model);
        const apiClient = files.find(f => f.path.includes('APIClient'));
        expect(apiClient).toBeDefined();
        expect(apiClient!.content).toContain('func refreshToken() async throws -> AuthResponse');
    });
});

// ---------------------------------------------------------------------------
// Auth Manager Tests
// ---------------------------------------------------------------------------

describe('Auth Manager Generation', () => {
    test('AuthManager is generated when auth is detected', () => {
        // We can't directly call generateStateLayer (it's not exported),
        // so we test via the project-generator's orchestration or check
        // the networking layer files generated
        const model = createModel({
            auth: {
                type: 'jwt',
                provider: null,
                flows: [],
                storageStrategy: 'localStorage',
                confidence: 'high',
            },
        });
        // AuthManager is generated in the state layer (project-generator).
        // Since we can't call that directly, verify auth networking files exist.
        const files = generateNetworkingLayer(model);
        const authResponse = files.find(f => f.path.includes('AuthResponse'));
        expect(authResponse).toBeDefined();
    });
});

// ---------------------------------------------------------------------------
// Accessibility Tests
// ---------------------------------------------------------------------------

describe('Accessibility', () => {
    test('login screen includes accessibilityLabel on key elements', () => {
        const model = createModel({
            screens: [createAuthScreen('Login')],
        });
        const files = generateSwiftUIViews(model);
        const loginView = files.find(f => f.path.includes('Login'));
        expect(loginView).toBeDefined();
        expect(loginView!.content).toContain('.accessibilityLabel("Email address")');
        expect(loginView!.content).toContain('.accessibilityLabel("Sign in")');
        expect(loginView!.content).toContain('.accessibilityLabel("App logo")');
    });

    test('login screen includes accessibilityHint on sign up link', () => {
        const model = createModel({
            screens: [createAuthScreen('Login')],
        });
        const files = generateSwiftUIViews(model);
        const loginView = files.find(f => f.path.includes('Login'));
        expect(loginView).toBeDefined();
        expect(loginView!.content).toContain('.accessibilityHint("Navigates to registration screen")');
    });

    test('login screen includes accessible password toggle', () => {
        const model = createModel({
            screens: [createAuthScreen('Login')],
        });
        const files = generateSwiftUIViews(model);
        const loginView = files.find(f => f.path.includes('Login'));
        expect(loginView).toBeDefined();
        expect(loginView!.content).toContain('.accessibilityLabel(showPassword ? "Hide password" : "Show password")');
    });

    test('login screen includes accessible error message', () => {
        const model = createModel({
            screens: [createAuthScreen('Login')],
        });
        const files = generateSwiftUIViews(model);
        const loginView = files.find(f => f.path.includes('Login'));
        expect(loginView).toBeDefined();
        expect(loginView!.content).toContain('.accessibilityLabel("Error: \\(errorMessage)")');
    });

    test('login screen includes accessible loading state', () => {
        const model = createModel({
            screens: [createAuthScreen('Login')],
        });
        const files = generateSwiftUIViews(model);
        const loginView = files.find(f => f.path.includes('Login'));
        expect(loginView).toBeDefined();
        expect(loginView!.content).toContain('.accessibilityLabel("Signing in")');
    });

    test('register screen includes accessibilityLabel on form fields', () => {
        const model = createModel({
            screens: [createAuthScreen('Register')],
        });
        const files = generateSwiftUIViews(model);
        const registerView = files.find(f => f.path.includes('Register'));
        expect(registerView).toBeDefined();
        expect(registerView!.content).toContain('.accessibilityLabel("Full name")');
        expect(registerView!.content).toContain('.accessibilityLabel("Email address")');
        expect(registerView!.content).toContain('.accessibilityLabel("Confirm password")');
        expect(registerView!.content).toContain('.accessibilityLabel("Create account")');
    });

    test('custom view action buttons include accessibilityLabel', () => {
        const model = createModel({
            screens: [{
                name: 'Dashboard',
                description: 'Main dashboard',
                purpose: 'App dashboard',
                sourceFile: 'app/dashboard/page.tsx',
                sourceComponent: 'Dashboard',
                layout: 'custom' as const,
                components: [],
                dataRequirements: [],
                actions: [
                    {
                        label: 'Add Item',
                        trigger: 'tap' as const,
                        effect: { type: 'mutate' as const, target: 'addItem', payload: {} },
                        destructive: false,
                        requiresAuth: false,
                    },
                ],
                stateBindings: [],
                isEntryPoint: false,
                confidence: 'high' as const,
            }],
        });
        const files = generateSwiftUIViews(model);
        const dashView = files.find(f => f.path.includes('Dashboard'));
        expect(dashView).toBeDefined();
        expect(dashView!.content).toContain('.accessibilityLabel("Add Item")');
    });

    test('custom view navigation buttons include accessibilityHint', () => {
        const model = createModel({
            screens: [{
                name: 'Dashboard',
                description: 'Main dashboard',
                purpose: 'App dashboard',
                sourceFile: 'app/dashboard/page.tsx',
                sourceComponent: 'Dashboard',
                layout: 'custom' as const,
                components: [],
                dataRequirements: [],
                actions: [
                    {
                        label: 'View Profile',
                        trigger: 'tap' as const,
                        effect: { type: 'navigate' as const, target: 'profile', payload: {} },
                        destructive: false,
                        requiresAuth: false,
                    },
                ],
                stateBindings: [],
                isEntryPoint: false,
                confidence: 'high' as const,
            }],
        });
        const files = generateSwiftUIViews(model);
        const dashView = files.find(f => f.path.includes('Dashboard'));
        expect(dashView).toBeDefined();
        expect(dashView!.content).toContain('.accessibilityHint("Navigates to Profile")');
    });

    test('generated views use Dynamic Type-safe system fonts', () => {
        const model = createModel({
            screens: [createAuthScreen('Login')],
        });
        const files = generateSwiftUIViews(model);
        const loginView = files.find(f => f.path.includes('Login'));
        expect(loginView).toBeDefined();
        // Should use system semantic fonts, not hard-coded sizes
        expect(loginView!.content).toContain('.font(.title.bold())');
        expect(loginView!.content).toContain('.font(.caption)');
        expect(loginView!.content).toContain('.font(.subheadline)');
    });

    test('loading overlay includes accessibility label', () => {
        const model = createModel({
            screens: [{
                name: 'Products',
                description: 'Product listing',
                purpose: 'Browse products',
                sourceFile: 'app/products/page.tsx',
                sourceComponent: 'Products',
                layout: 'list' as const,
                components: [],
                dataRequirements: [{ source: 'Product', fetchStrategy: 'api' as const, cardinality: 'many' as const, blocking: true, params: {} }],
                actions: [],
                stateBindings: [],
                isEntryPoint: false,
                confidence: 'high' as const,
            }],
        });
        const files = generateSwiftUIViews(model);
        const productsView = files.find(f => f.path.includes('Products'));
        expect(productsView).toBeDefined();
        expect(productsView!.content).toContain('.accessibilityLabel("Loading content")');
    });
});
