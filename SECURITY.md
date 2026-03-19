# Security Policy

## Supported Versions

| Version | Supported          |
|---------|--------------------|
| latest  | Yes                |
| < latest| No                 |

Only the latest release receives security updates. We recommend always using the most recent version.

## Reporting a Vulnerability

If you discover a security vulnerability in Morphkit, please report it responsibly.

**Email:** security@morphkit.dev

**What to include:**
- Description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Suggested fix (if any)

**Please do NOT:**
- Open a public GitHub issue for security vulnerabilities
- Exploit the vulnerability beyond what is necessary to demonstrate it

## Response Timeline

- **Acknowledgment:** Within 48 hours of report
- **Initial assessment:** Within 5 business days
- **Fix for critical issues:** Within 30 days
- **Fix for non-critical issues:** Within 90 days

## Scope

The following are in scope for security reports:

### CLI Tool (`morphkit-cli`)
- Path traversal in file generation
- Command injection via user input
- Arbitrary code execution
- Dependency vulnerabilities

### Generated Swift Code
- Insecure network configurations (HTTP instead of HTTPS)
- Hardcoded credentials or tokens in output
- Insecure data storage patterns
- Missing input validation

### Website & API (`morphkit.dev`)
- Authentication bypass
- API key leakage
- Cross-site scripting (XSS)
- SQL injection / NoSQL injection
- Broken access control (accessing other users' data)

### Out of Scope
- Denial of service attacks
- Social engineering
- Issues in third-party dependencies (report to the upstream project)
- Issues requiring physical access to a device

## Credit

Security researchers who responsibly disclose vulnerabilities will be credited in release notes, unless they prefer to remain anonymous.

## Security Best Practices for Users

1. **API Keys:** Store your `MORPHKIT_API_KEY` in environment variables or `~/.morphkit/config`, never in source code
2. **Generated Code:** Review generated `APIConfiguration.swift` and update the base URL before shipping to production
3. **Dependencies:** Keep Morphkit updated to receive the latest security fixes
