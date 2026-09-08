export const placementQuestions = [
  [1, "Compute 3/4 + 1/6. Enter a fraction or decimal.", 11/12, "3/4 = 9/12 and 1/6 = 2/12, so the sum is 11/12."],
  [2, "Solve 3x + 5 = 20. What is x?", 5, "Subtract 5, then divide both sides by 3: x = 5."],
  [3, "Find the slope through (1, 2) and (4, 8).", 2, "Slope = (8 - 2)/(4 - 1) = 6/3 = 2."],
  [4, "Evaluate 2 to the power -3.", 1/8, "2^(-3) = 1/(2³) = 1/8."],
  [5, "What is the smaller root of x² - 5x + 6 = 0?", 2, "(x - 2)(x - 3) = 0, so the roots are 2 and 3."],
  [6, "Simplify (x² - 9)/(x - 3). What input remains excluded?", 3, "The expression becomes x + 3, but x = 3 stays excluded by the original denominator."],
  [7, "If f(x) = x² - 2x, what is f(-3)?", 15, "(-3)² - 2(-3) = 9 + 6 = 15."],
  [8, "Evaluate log base 2 of 32.", 5, "2⁵ = 32, so log₂(32) = 5."],
  [9, "A right triangle has hypotenuse 10 and angle 30°. What is the opposite side?", 5, "opposite = 10 sin(30°) = 10 × 1/2 = 5."],
  [10, "Evaluate cos(π) on the unit circle. The angle is in radians.", -1, "π radians is a half-turn. The point is (-1, 0), so cosine is -1."],
  [11, "How many solutions does sin(θ) = 1/2 have on 0 ≤ θ < 2π?", 2, "Two: π/6 and 5π/6. The calculator's principal value is only one of them."],
  [12, "For f(x) = x², what is the average rate of change from x = 2 to x = 5?", 7, "(f(5) - f(2))/(5 - 2) = (25 - 4)/3 = 7."],
].map(([chapter, prompt, answer, explanation]) => ({ chapter, prompt, answer, explanation }));

// Deliberately accepts only numbers or a single numeric fraction. No eval and
// no fuzzy matching that might award a mathematically different answer.
export function numericAnswer(text) {
  const value = String(text).trim().replaceAll("−", "-");
  const number = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)";
  if (new RegExp(`^${number}$`).test(value)) return Number(value);
  const fraction = value.match(new RegExp(`^(${number})\\s*/\\s*(${number})$`));
  if (fraction && Number(fraction[2]) !== 0) return Number(fraction[1])/Number(fraction[2]);
  return NaN;
}
export function checkPlacement(question, answer) {
  const n = numericAnswer(answer);
  return Number.isFinite(n) && Math.abs(n-question.answer) <= 0.0005;
}
export function placementStart(results) {
  const firstGap = placementQuestions.find((q, i) => results[i] !== true);
  return firstGap?.chapter || 12;
}
export function validPlacement(value) {
  return Array.isArray(value) && value.length === placementQuestions.length && value.every(x => typeof x === "boolean");
}
