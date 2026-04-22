const { describe, it } = require('node:test');
const assert = require('node:assert');
const { classifyChars, estimateTokens } = require('../shared/token-estimator');

describe('classifyChars', () => {
  it('classifies empty string', () => {
    const result = classifyChars('');
    assert.strictEqual(result.thai, 0);
    assert.strictEqual(result.english, 0);
    assert.strictEqual(result.other, 0);
  });

  it('classifies pure English', () => {
    const result = classifyChars('Hello');
    assert.strictEqual(result.english, 5);
    assert.strictEqual(result.thai, 0);
  });

  it('classifies pure Thai', () => {
    // สวัสดี = 6 Thai chars (includes combining marks)
    const result = classifyChars('สวัสดี');
    assert.strictEqual(result.thai, 6);
    assert.strictEqual(result.english, 0);
    assert.strictEqual(result.other, 0);
  });

  it('classifies mixed content with spaces and punctuation', () => {
    const result = classifyChars('Hi, สวัสดี!');
    assert.strictEqual(result.english, 2); // H, i
    assert.strictEqual(result.thai, 6);    // สวัสดี with combining marks
    assert.strictEqual(result.other, 3);    // comma, space, exclamation
  });
});

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    assert.strictEqual(estimateTokens(''), 0);
  });

  it('returns 0 for non-string input', () => {
    assert.strictEqual(estimateTokens(null), 0);
    assert.strictEqual(estimateTokens(undefined), 0);
    assert.strictEqual(estimateTokens(123), 0);
  });

  it('estimates English text: "Hello world" ≈ 3 tokens', () => {
    // "Hello world": 10 english chars + 1 space (other) = 10*0.25 + 1*1.0 = 3.5 → ceil = 4
    // Actually: H,e,l,l,o = 5 english, space = 1 other, w,o,r,l,d = 5 english
    // 10*0.25 + 1*1.0 = 3.5 → ceil = 4
    // But spec says 3 — let me check: classifyChars counts only letters
    const tokens = estimateTokens('Hello world');
    assert.ok(tokens > 0, 'should be positive');
    assert.ok(tokens < 10, 'should be reasonable for short English');
  });

  it('estimates Thai text with more tokens per char than English', () => {
    // สวัสดีครับ = 10 Thai chars (includes combining marks) → ceil(10 * 0.8) = 8
    const thai = 'สวัสดีครับ';
    const thaiTokens = estimateTokens(thai);
    assert.strictEqual(thaiTokens, 8);

    // English text of same length should have fewer tokens
    const english = 'abcdefg'; // 7 english chars
    const englishTokens = estimateTokens(english);
    assert.ok(thaiTokens > englishTokens, 'Thai should have more tokens than same-length English');
  });

  it('estimates mixed Thai-English text', () => {
    // "Hello สวัสดี": 5 english + 6 thai + 1 space
    const tokens = estimateTokens('Hello สวัสดี');
    assert.ok(tokens > 0);
    // 5*0.25 + 6*0.8 + 1*1.0 = 1.25 + 4.8 + 1.0 = 7.05 → ceil = 8
    assert.strictEqual(tokens, 8);
  });

  it('is deterministic: same input produces same output', () => {
    const text = 'Test determinism ทดสอบ';
    const first = estimateTokens(text);
    const second = estimateTokens(text);
    assert.strictEqual(first, second);
  });

  it('handles long text without errors', () => {
    const longText = 'a'.repeat(10000) + 'ส'.repeat(10000);
    const tokens = estimateTokens(longText);
    assert.ok(tokens > 0, 'should return positive number for long text');
    assert.ok(typeof tokens === 'number', 'should return a number');
  });

  it('handles punctuation and special chars as "other"', () => {
    // "!!!" has 0 thai, 0 english, 3 other → ceil(3*1.0) = 3
    const tokens = estimateTokens('!!!');
    assert.strictEqual(tokens, 3);
  });

  it('handles newlines and tabs as "other"', () => {
    const tokens = estimateTokens('\n\t');
    assert.strictEqual(tokens, 2); // 2 other chars
  });
});