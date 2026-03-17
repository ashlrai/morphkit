/**
 * @module prompts/intent-extraction
 *
 * Prompt templates for analyzing React / Next.js component intent.
 * The model acts as a senior iOS + React engineer to determine not just
 * what a component renders, but WHY it exists and what user goals it serves.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Contextual information about the wider application. */
export interface AppContext {
  /** Name of the application / product. */
  appName: string;
  /** Brief description of the app's domain (e.g. "e-commerce marketplace"). */
  domain: string;
  /** Routes / pages already discovered in the app. */
  knownRoutes?: string[];
  /** Global state shape summary, if available. */
  globalStateShape?: string;
  /** Any additional context the caller wants to inject. */
  additionalContext?: string;
}

// ---------------------------------------------------------------------------
// System Prompt
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a principal-level software engineer with 10+ years of experience in both React/Next.js and iOS/SwiftUI development. You have shipped multiple top-10 App Store apps and large-scale React applications.

Your task is to analyze React component source code and extract the INTENT behind it — not a surface-level description of JSX elements, but a deep understanding of:

1. **Purpose** — What real-world problem does this component solve? Describe it the way a product manager would.
2. **User Goals** — What is the end-user trying to accomplish when they interact with this screen?
3. **Business Logic** — What rules, constraints, or domain logic is embedded in the component? (validation, permissions, conditional rendering based on state, etc.)
4. **UX Patterns** — What implicit interaction patterns are used? (infinite scroll, optimistic updates, skeleton loading, debounced search, drag-and-drop, pull-to-refresh equivalents, etc.)
5. **Suggested iOS Pattern** — Given the above, what is the most idiomatic iOS/SwiftUI pattern to implement equivalent functionality?

Always respond with valid JSON matching the requested schema. Be specific and actionable — avoid generic descriptions like "displays data".`;

// ---------------------------------------------------------------------------
// Few-Shot Examples
// ---------------------------------------------------------------------------

const FEW_SHOT_EXAMPLES = `
### Example 1

**Input code:**
\`\`\`tsx
export function ProductList({ category }: { category: string }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const observer = useRef<IntersectionObserver>();

  const lastProductRef = useCallback((node: HTMLDivElement) => {
    if (loading) return;
    if (observer.current) observer.current.disconnect();
    observer.current = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) setPage(prev => prev + 1);
    });
    if (node) observer.current.observe(node);
  }, [loading]);

  useEffect(() => {
    fetchProducts(category, page).then(data => {
      setProducts(prev => [...prev, ...data]);
    });
  }, [category, page]);

  return (
    <div className="grid grid-cols-2 gap-4 p-4">
      {products.map((p, i) => (
        <div key={p.id} ref={i === products.length - 1 ? lastProductRef : null}>
          <img src={p.image} alt={p.name} className="rounded-lg" />
          <h3 className="font-semibold mt-2">{p.name}</h3>
          <p className="text-gray-500">\${p.price}</p>
        </div>
      ))}
      {loading && <Skeleton count={4} />}
    </div>
  );
}
\`\`\`

**Expected output:**
\`\`\`json
{
  "purpose": "Paginated product catalog grid filtered by category, with infinite scroll loading for seamless browsing",
  "userGoals": [
    "Browse products within a specific category",
    "Discover products by scrolling without explicit pagination controls",
    "Quickly assess products via image, name, and price at a glance"
  ],
  "businessLogic": [
    "Products are fetched per-category with server-side pagination",
    "New products append to existing list (no replacement) for continuous scroll",
    "Loading state prevents duplicate page fetches during scroll"
  ],
  "uxPatterns": [
    "Infinite scroll via IntersectionObserver on the last item",
    "Skeleton loading placeholders during data fetch",
    "2-column responsive grid layout"
  ],
  "suggestedIOSPattern": "LazyVGrid with 2 columns using ScrollView, .task for initial load, onAppear on last item to trigger next page fetch, ProgressView as loading indicator"
}
\`\`\`

### Example 2

**Input code:**
\`\`\`tsx
export function SettingsForm() {
  const { user, updateUser } = useAuth();
  const [form, setForm] = useState({ name: user.name, email: user.email });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await updateUser(form);
      setToast("Settings saved!");
    } catch {
      setToast("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="max-w-md mx-auto p-6 space-y-4">
      <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} />
      <input value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} />
      <button type="submit" disabled={saving}>
        {saving ? "Saving..." : "Save Changes"}
      </button>
      {toast && <div className="toast">{toast}</div>}
    </form>
  );
}
\`\`\`

**Expected output:**
\`\`\`json
{
  "purpose": "User profile settings editor with optimistic save feedback and error handling",
  "userGoals": [
    "Update personal profile information (name and email)",
    "Receive confirmation that changes were saved successfully",
    "Understand when a save operation fails and can be retried"
  ],
  "businessLogic": [
    "Form is pre-populated from authenticated user context",
    "Save operation goes through an auth-layer updateUser function",
    "Error handling provides user-facing feedback without exposing internals"
  ],
  "uxPatterns": [
    "Inline form with controlled inputs",
    "Disabled submit button during save to prevent double-submission",
    "Toast notification for success/failure feedback"
  ],
  "suggestedIOSPattern": "Form with TextField bindings inside a NavigationStack, .task to load initial data, async button with ProgressView for save state, .alert or .snackbar overlay for toast feedback"
}
\`\`\`
`;

// ---------------------------------------------------------------------------
// Prompt Builder
// ---------------------------------------------------------------------------

/**
 * Build the full prompt for intent extraction.
 *
 * @param code - The raw source code of the React component to analyze.
 * @param context - Application-level context to help the model reason about the component's role.
 * @returns The assembled user prompt string (system prompt is separate).
 */
export function buildIntentExtractionPrompt(
  code: string,
  context: AppContext
): string {
  const parts: string[] = [];

  parts.push(`# Intent Extraction Task`);
  parts.push(``);
  parts.push(
    `Analyze the following React/Next.js component from **${context.appName}**, a ${context.domain} application.`
  );

  if (context.knownRoutes?.length) {
    parts.push(``);
    parts.push(`## Known Routes in the Application`);
    parts.push(context.knownRoutes.map((r) => `- \`${r}\``).join("\n"));
  }

  if (context.globalStateShape) {
    parts.push(``);
    parts.push(`## Global State Shape`);
    parts.push("```");
    parts.push(context.globalStateShape);
    parts.push("```");
  }

  if (context.additionalContext) {
    parts.push(``);
    parts.push(`## Additional Context`);
    parts.push(context.additionalContext);
  }

  parts.push(``);
  parts.push(`## Component Source Code`);
  parts.push("```tsx");
  parts.push(code);
  parts.push("```");

  parts.push(``);
  parts.push(`## Reference Examples`);
  parts.push(FEW_SHOT_EXAMPLES);

  parts.push(``);
  parts.push(
    `Respond with a single JSON object matching the IntentAnalysis schema. Do not include any text outside the JSON.`
  );

  return parts.join("\n");
}

/**
 * The system prompt for intent extraction calls.
 * Exported so GrokClient can set it as the system message.
 */
export const INTENT_EXTRACTION_SYSTEM_PROMPT = SYSTEM_PROMPT;
