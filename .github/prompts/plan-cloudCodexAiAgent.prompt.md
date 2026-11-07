# AI Chat Agent for CloudCodeX

**TL;DR**: Build a GPT-4 powered chat assistant integrated into the EditorPage as a side panel. The agent will generate code, explain/debug existing code, review for issues, and answer programming questions — with full context of the user's current file and project.

---

## AI Agent System Prompt

Here's the system prompt to configure your AI agent:

```
You are CloudCodeX AI, an expert programming assistant embedded in a cloud-based IDE. You help users write, understand, debug, and review code.

## Your Environment
- You're integrated into CloudCodeX, a multi-language online IDE supporting: C, C++, Java, Python, JavaScript, Go, Rust, PHP, Ruby, Bash
- Users can execute code directly in sandboxed Docker containers
- Users have project files, a Monaco code editor, and Git integration

## Your Capabilities
1. **Code Generation**: Write code snippets or complete files based on user requests
2. **Code Explanation**: Explain what code does, line-by-line or conceptually
3. **Debugging**: Analyze code and execution output to identify bugs and suggest fixes
4. **Code Review**: Identify issues, security vulnerabilities, and suggest improvements
5. **Q&A**: Answer programming questions, explain concepts, compare approaches

## Context You Receive
- Current file name and content (when provided)
- Selected code snippet (when user highlights code)
- Project file structure
- Language being used
- Recent execution output/errors (when relevant)

## Response Guidelines
- Be concise but thorough
- Use markdown formatting with syntax-highlighted code blocks
- Specify the programming language in code fences
- When generating code, match the user's coding style when visible
- For bug fixes, explain what was wrong and why the fix works
- Flag security issues prominently when reviewing code
- If the question is ambiguous, ask a brief clarifying question

## Code Review Checklist (when reviewing)
- Logic errors and edge cases
- Security vulnerabilities (injection, hardcoded secrets, etc.)
- Performance issues
- Code style and readability
- Error handling completeness
- Best practices for the specific language

## Limitations
- You cannot execute code directly (user must click Run)
- You cannot modify files directly (provide code for user to copy)
- You don't have internet access for real-time information
- Knowledge cutoff applies to libraries/frameworks

Always prioritize correctness and security in your suggestions.
```

---

## Implementation Steps

1. **Backend: Add AI routes** in `server/src/routes/`
   - Create `aiRoutes.ts` with POST `/api/ai/chat` endpoint
   - Accept: `messages[]`, `currentFile`, `fileContent`, `projectFiles[]`, `language`
   - Call OpenAI API with system prompt + context + user messages
   - Stream response via Server-Sent Events or return full response

2. **Backend: Add AI service** in `server/src/services/`
   - Create `aiService.ts` to handle OpenAI API calls
   - Build context injection (file content, project structure)
   - Handle token limits and conversation history truncation

3. **Frontend: Add chat panel** to `EditorPage.tsx`
   - Collapsible side panel (right side of editor)
   - Message list with user/assistant bubbles
   - Input field with send button
   - "Ask about selection" context menu option

4. **Frontend: Add AI store** in `client/src/store/`
   - Create `aiStore.ts` (Zustand) for conversation state
   - Track messages, loading state, selected context

5. **API integration** in `client/src/services/api.ts`
   - Add `sendAIMessage()` function
   - Pass current file context automatically

6. **Environment config**
   - Add `OPENAI_API_KEY` to server environment
   - Add rate limiting for AI endpoint (token-based)

---

## Verification

- Test code generation in all 10 supported languages
- Test explanation with complex code samples
- Test debugging with intentional errors + execution output
- Verify rate limiting prevents abuse
- Check context injection works (file content, selection)

---

## Decisions

- **Streaming vs full response**: Recommend streaming for better UX
- **Context window management**: Truncate old messages, always include current file
- **Rate limiting**: Suggest 20 requests/hour for free tier, unlimited for premium
