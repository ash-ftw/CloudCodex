# Contributing to CloudCodeX

Thank you for your interest in contributing to **CloudCodeX**! We welcome contributions from developers of all skill levels.

---

## Code of Conduct

By participating in this project, you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md). Please read it to ensure a welcoming and inclusive environment for everyone.

---

## How to Contribute

### 1. Reporting Bugs

Before creating a bug report, please check existing [GitHub Issues](https://github.com/ash-ftw/CloudCodex/issues) to avoid duplicates.

When reporting a bug, use our **Bug Report Template** and include:
- A clear, descriptive title
- Steps to reproduce the bug
- Expected vs. actual behavior
- Screenshots or console logs if applicable
- Your operating system, browser, and Node.js version

### 2. Suggesting Enhancements

Feature requests are tracked in [GitHub Issues](https://github.com/ash-ftw/CloudCodex/issues). When suggesting a feature:
- Explain why this enhancement would be useful to most users.
- Provide examples of how it should work or mockups if applicable.

### 3. Submitting Pull Requests (PRs)

#### Step 1: Fork and Clone
```bash
# Fork the repo on GitHub, then clone your fork:
git clone https://github.com/<your-username>/CloudCodex.git
cd CloudCodex
```

#### Step 2: Create a Branch
Use descriptive branch names following conventions:
- `feat/feature-name` (for new features)
- `fix/bug-description` (for bug fixes)
- `docs/doc-update` (for documentation changes)
- `refactor/component-name` (for code refactoring)

```bash
git checkout -b feat/your-feature-name
```

#### Step 3: Install and Develop
```bash
npm run install:all
npm run dev
```

Ensure all dependencies install cleanly and both client and server start without errors.

#### Step 4: Commit Conventions
We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat:` A new feature
- `fix:` A bug fix
- `docs:` Documentation only changes
- `style:` Changes that do not affect the meaning of the code
- `refactor:` A code change that neither fixes a bug nor adds a feature
- `perf:` A code change that improves performance
- `test:` Adding missing tests or correcting existing tests
- `chore:` Changes to the build process or auxiliary tools

*Example:* `feat(editor): add bracket pair colorization setting`

#### Step 5: Test and Lint
Before pushing, run checks locally:
```bash
# In client/
npm run lint
npm run build

# In server/
npm run lint
npm run build
```

#### Step 6: Push and Open a PR
```bash
git push origin feat/your-feature-name
```
Open a Pull Request against the `main` branch of `ash-ftw/CloudCodex`. Complete the PR template checklist.

---

## Coding Standards

- **TypeScript First**: Write strictly typed code. Avoid `any` wherever possible.
- **Clean Architecture**: Follow the Single Responsibility Principle (SRP) and keep components modular.
- **Secrets & Safety**: Never commit credentials, `.env` files, or private keys.
- **Formatting**: Keep code clean, idiomatic, and lint-error free.

---

## Questions?

Feel free to open a [Discussion](https://github.com/ash-ftw/CloudCodex/discussions) or reach out via issues. We are excited to collaborate with you!
