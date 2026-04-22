/**
 * Shared Token Estimator — consistent Thai/English token counting
 * Used by both orchestrator-router and smart-optimizer.
 */

function classifyChars(text) {
  let thai = 0, english = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0x0E00 && c <= 0x0E7F) thai++;
    else if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) english++;
  }
  return { thai, english, other: text.length - thai - english };
}

function estimateTokens(text) {
  if (typeof text !== 'string' || text.length === 0) return 0;
  const { thai, english, other } = classifyChars(text);
  return Math.ceil(thai * 0.8 + english * 0.25 + other * 1.0);
}

module.exports = { classifyChars, estimateTokens };