/**
 * Custom router for local Claude Code Router.
 *
 * This selects a model BEFORE the request is sent.
 * It is not an automatic retry/fallback handler after 429 or provider errors.
 */
module.exports = async function router(req, config) {
  const messages = req?.body?.messages || [];
  const text = JSON.stringify(messages).toLowerCase();

  if (text.length > 60000) {
    return "gemini,gemini-2.5-pro";
  }

  if (
    text.includes("security") ||
    text.includes("vulnerability") ||
    text.includes("review current git diff") ||
    text.includes("code review") ||
    text.includes("audit")
  ) {
    return "zai,glm-5.1";
  }

  if (
    text.includes("summarize") ||
    text.includes("summary") ||
    text.includes("format") ||
    text.includes("rename") ||
    text.includes("simple edit")
  ) {
    return "ollama,qwen2.5-coder:latest";
  }

  return null;
};
