import { numericAnswer } from "./mathReadiness.js";
export const placementQuestions = [
  [
    1,
    "What input is excluded from (x²−9)/(x−3), even after cancellation?",
    3,
    "x=3 makes the original denominator zero. Simplification does not restore that input."
  ],
  [
    1,
    "Evaluate cos(π). The angle is in radians.",
    -1,
    "π is a half-turn; the unit-circle x coordinate is −1."
  ],
  [
    2,
    "Find the limit of (x²−4)/(x−2) as x approaches 2.",
    4,
    "For x≠2 the expression is x+2, so the limit is 4."
  ],
  [
    3,
    "For f(x)=(x²−1)/(x−1) when x≠1, what should f(1) be to make f continuous?",
    2,
    "The nearby expression is x+1, so continuity requires f(1)=2."
  ],
  [
    4,
    "For f(x)=x², what is f′(3)?",
    6,
    "The difference quotient is 2x+h, whose limit is 2x. At x=3 this is 6."
  ],
  [
    5,
    "For f(x)=(3x+1)², what is f′(1)?",
    24,
    "The chain rule gives 2(3x+1)·3, which is 24 at x=1."
  ],
  [
    6,
    "What is the derivative of sin(x) at x=0, using radians?",
    1,
    "The derivative is cos(x); cos(0)=1."
  ],
  [
    7,
    "On x²+y²=25, what is dy/dx at (3,4)? Enter a fraction or decimal.",
    -0.75,
    "2x+2y y′=0 gives y′=−x/y=−3/4."
  ],
  [
    8,
    "A square has side 3 cm increasing at 2 cm/s. How fast is its area increasing (cm²/s)?",
    12,
    "A=s², so dA/dt=2s ds/dt=2·3·2=12."
  ],
  [
    9,
    "What is the absolute maximum of f(x)=x² on [−1,2]?",
    4,
    "Check the critical point 0 and both endpoints: values 0,1,4. The maximum is 4."
  ],
  [
    11,
    "For F′(x)=2x and F(0)=3, what is F(2)?",
    7,
    "F(x)=x²+C; F(0)=3 gives C=3. F(2)=7."
  ],
  [
    12,
    "Evaluate the definite integral of 2x from 0 to 3.",
    9,
    "An antiderivative is x²; upper minus lower is 9−0=9."
  ]
].map(([chapter,prompt,answer,explanation])=>({chapter,prompt,answer,explanation}));
export function checkPlacement(question, answer) {
  const value=numericAnswer(answer);
  return Number.isFinite(value) && Math.abs(value-question.answer)<=0.0005;
}
export function validPlacement(value) {
  return Array.isArray(value) && value.length===placementQuestions.length && value.every(x=>typeof x==="boolean");
}
export function placementStart(results) {
  // A quick sample never certifies a unit or skips independent study.
  return placementQuestions.find((q,i)=>results[i]!==true)?.chapter || 2;
}
