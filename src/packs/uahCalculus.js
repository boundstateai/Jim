// Original BoundState lessons and examples; references are optional further reading.
// MA 171 identity verified 2026-10-09. This is not an instructor syllabus.
export const courseSources = [
  {label: "UAH MA 171 course listing and study support", url: "https://www.uah.edu/ssc/pass/pass-schedule"},
  {label: "UAH prerequisite topic summary (historical, 2015)", url: "https://www.uah.edu/images/research/cmsa/pdf/CS214/CS_214_15S_Course_Introduction_v19.pdf"},
  {label: "Optional reference: OpenStax Calculus Volume 1", url: "https://openstax.org/details/books/calculus-volume-1"}
];
const units = [
  [
    "Calculus foundations",
    "Foundations"
  ],
  [
    "Limits",
    "Limits"
  ],
  [
    "Continuity & one-sided behavior",
    "Limits"
  ],
  [
    "The derivative",
    "Derivatives"
  ],
  [
    "Differentiation rules",
    "Derivatives"
  ],
  [
    "Trig, exponential & log derivatives",
    "Derivatives"
  ],
  [
    "Implicit & inverse differentiation",
    "Applications"
  ],
  [
    "Related rates & local approximation",
    "Applications"
  ],
  [
    "Curve behavior & theorems",
    "Applications"
  ],
  [
    "Optimization & numerical roots",
    "Applications"
  ],
  [
    "Antiderivatives & accumulation",
    "Integrals"
  ],
  [
    "The Fundamental Theorem & substitution",
    "Integrals"
  ]
];
const rows = [
  [
    1,
    "domains",
    "Domains and cancellation",
    "(x²−a²)/(x−a)=x+a, x≠a",
    "Simplification preserves the original domain; a removable hole remains excluded.",
    "(x²−16)/(x−4)=x+4 for x≠4. The limit at 4 is 8, but the original function is undefined there.",
    "Cancel factors, never terms in a sum."
  ],
  [
    1,
    "composition",
    "Composition and inverses",
    "(f∘g)(x)=f(g(x)); f⁻¹(f(x))=x on the inverse domain",
    "Track allowed inputs through both functions.",
    "f(x)=√x and g(x)=x−3 give f(g(x))=√(x−3), with x≥3.",
    "An inverse is not a reciprocal; a non-one-to-one function needs a domain restriction."
  ],
  [
    1,
    "radians",
    "Radians and trig foundations",
    "π radians=180°; sin²x+cos²x=1",
    "Calculus trig derivative formulas assume radians.",
    "sin(π/6)=1/2; cos(π/6)=√3/2. Thus tan(π/6)=1/√3.",
    "Do not use degrees inside the standard trig limit or derivative formulas."
  ],
  [
    1,
    "logs",
    "Exponentials and logarithms",
    "ln(eˣ)=x; e^(ln x)=x for x>0",
    "Logs undo exponentials on the correct domain.",
    "e^(2x)=7 gives 2x=ln 7 and x=(ln 7)/2.",
    "ln(a+b) is not ln a+ln b."
  ],
  [
    2,
    "limits",
    "What a limit means",
    "lim(x→a) f(x)=L",
    "A limit describes nearby outputs, independently of the value at the point.",
    "For f(x)=(x²−9)/(x−3), x≠3: f(x)=x+3 nearby, so the limit at 3 is 6.",
    "A table suggests a limit; it does not prove one."
  ],
  [
    2,
    "limit-laws",
    "Limit laws and substitution",
    "lim(f+g)=lim f+lim g when both finite limits exist",
    "Continuous functions permit substitution; check denominators first.",
    "lim(x→2)(3x²−x+1)=12−2+1=11.",
    "0/0 is an indeterminate form, not an answer."
  ],
  [
    2,
    "rationalize",
    "Factoring and rationalization",
    "(√(x+c)−√c)/x=1/(√(x+c)+√c), x≠0, c>0",
    "Remove an indeterminate form using an equivalent expression nearby.",
    "lim(x→0)(√(x+4)−2)/x=lim 1/(√(x+4)+2)=1/4.",
    "The conjugate must multiply numerator and denominator."
  ],
  [
    2,
    "trig-limits",
    "Squeeze theorem and trig limits",
    "lim(x→0) sin x/x=1 (radians)",
    "Bounding functions can force a shared limit.",
    "lim(x→0) sin(5x)/x=5 lim sin(5x)/(5x)=5.",
    "For x²sin(1/x), bounds −x² and x² show limit 0; sin(1/x) itself has no limit."
  ],
  [
    3,
    "one-sided",
    "One-sided limits",
    "A two-sided finite limit exists iff left and right limits agree",
    "Check each side at a jump or sign-sensitive denominator.",
    "For |x|/x, the left limit at 0 is −1 and the right is 1, so the two-sided limit does not exist.",
    "A function value cannot repair mismatched one-sided limits."
  ],
  [
    3,
    "infinity",
    "Infinite limits and asymptotes",
    "lim(x→0⁺)1/x=+∞; lim(x→0⁻)1/x=−∞",
    "An infinite limit describes unbounded behavior, not a real output.",
    "lim(x→∞)(3x²+1)/(2x²−5)=3/2 after dividing by x².",
    "A horizontal asymptote can be crossed; check both directions at infinity."
  ],
  [
    3,
    "continuity",
    "Continuity at a point",
    "f(a) is defined, lim(x→a)f(x) exists, and the two are equal",
    "All three conditions are necessary.",
    "Define f(x)=(x²−4)/(x−2) for x≠2 and f(2)=k. Continuity requires k=4.",
    "Differentiability implies continuity; the converse fails at corners."
  ],
  [
    3,
    "ivt",
    "Intermediate Value Theorem",
    "Continuous f on [a,b] attains every value between f(a) and f(b)",
    "Continuity guarantees existence, not uniqueness.",
    "f(x)=x³−x−1 has f(1)=−1 and f(2)=5, so at least one root lies in (1,2).",
    "State continuity before invoking the theorem."
  ],
  [
    4,
    "difference-quotient",
    "Derivative from the definition",
    "f′(a)=lim(h→0)[f(a+h)−f(a)]/h",
    "Instantaneous change is the limit of average changes.",
    "For f(x)=x²: ((a+h)²−a²)/h=2a+h for h≠0. Its limit is 2a.",
    "Keep h≠0 while simplifying; only then take the limit."
  ],
  [
    4,
    "tangent",
    "Tangent lines",
    "y−f(a)=f′(a)(x−a)",
    "A tangent uses the value and instantaneous slope at the same point.",
    "For f(x)=x² at a=3: f(3)=9, f′(3)=6, so y−9=6(x−3), or y=6x−9.",
    "A tangent may cross the curve."
  ],
  [
    4,
    "differentiability",
    "Where derivatives fail",
    "A derivative requires a finite, common two-sided slope limit",
    "Corners, cusps, vertical tangents and discontinuities can prevent differentiability.",
    "For |x| at 0, left slope −1 and right slope 1 disagree. The function is continuous but not differentiable.",
    "An undefined derivative is not the same as derivative zero."
  ],
  [
    4,
    "motion",
    "Position, velocity and acceleration",
    "v(t)=s′(t); a(t)=s″(t); speed=|v(t)|",
    "Derivative units divide by one unit of the input.",
    "s(t)=t³−6t² metres gives v=3t²−12t m/s and a=6t−12 m/s². At t=1, v=−9 and a=−6, so speed is increasing.",
    "Speed increases when velocity and acceleration have the same sign."
  ],
  [
    5,
    "power",
    "Power and sum rules",
    "d(xⁿ)/dx=n x^(n−1), wherever the real power is differentiable",
    "Differentiate sums term by term; constants differentiate to zero.",
    "d(4x³−5x+7)/dx=12x²−5.",
    "For fractional or negative powers, state domain restrictions."
  ],
  [
    5,
    "product",
    "Product rule",
    "(fg)′=f′g+fg′",
    "Both factors can change.",
    "d(x² sin x)/dx=2x sin x+x² cos x.",
    "The derivative of a product is not the product of derivatives."
  ],
  [
    5,
    "quotient",
    "Quotient rule",
    "(f/g)′=(f′g−fg′)/g², g≠0",
    "The denominator is squared and the numerator order matters.",
    "d[x/(x+1)]/dx=((x+1)−x)/(x+1)²=1/(x+1)², x≠−1.",
    "Keep the original excluded inputs."
  ],
  [
    5,
    "chain",
    "Chain rule",
    "d f(g(x))/dx=f′(g(x))g′(x)",
    "Differentiate the outer function, keep the inside, then multiply by the inside derivative.",
    "d(3x²+1)⁴/dx=4(3x²+1)³·6x=24x(3x²+1)³.",
    "Every nested layer contributes a derivative factor."
  ],
  [
    6,
    "trig-derivatives",
    "Trig derivatives",
    "(sin x)′=cos x; (cos x)′=−sin x; (tan x)′=sec²x",
    "Use radians and combine with the chain rule.",
    "d cos(3x)/dx=−3sin(3x). Also (sec x)′=sec x tan x, (csc x)′=−csc x cot x, (cot x)′=−csc²x on their domains.",
    "The minus sign belongs to the cosine derivative."
  ],
  [
    6,
    "exp-derivatives",
    "Exponential derivatives",
    "(e^u)′=e^u u′; (a^u)′=a^u ln(a) u′, a>0",
    "The variable is in the exponent.",
    "d e^(x²)/dx=2x e^(x²); d 2ˣ/dx=2ˣ ln 2.",
    "Do not apply the power rule to a constant base with variable exponent."
  ],
  [
    6,
    "log-derivatives",
    "Logarithmic derivatives",
    "d ln|u|/dx=u′/u for u≠0",
    "A logarithmic derivative divides the inner derivative by the inner function.",
    "d ln(x²+1)/dx=2x/(x²+1), valid for all real x.",
    "ln x requires x>0; ln|x| extends the derivative formula to x≠0."
  ],
  [
    6,
    "inverse-trig",
    "Inverse trig derivatives",
    "(arcsin x)′=1/√(1−x²), |x|<1; (arctan x)′=1/(1+x²)",
    "Inverse functions have their own derivatives.",
    "d arctan(2x)/dx=2/(1+4x²); d arccos x/dx=−1/√(1−x²), |x|<1.",
    "arcsin x is not csc x; include inner derivatives."
  ],
  [
    7,
    "implicit",
    "Implicit differentiation",
    "Differentiate both sides; d(y²)/dx=2y y′ when y=y(x)",
    "Treat y as a function of x even without solving for it.",
    "x²+y²=25 gives 2x+2y y′=0, so y′=−x/y for y≠0. At (3,4), slope=−3/4.",
    "Do not omit y′ after differentiating a y term."
  ],
  [
    7,
    "implicit-second",
    "Second derivatives implicitly",
    "Differentiate y′ with respect to x, remembering y=y(x)",
    "A second derivative requires another chain or quotient rule.",
    "For x²+y²=25: y′=−x/y and y″=(−y+x y′)/y²=−25/y³ where y≠0.",
    "Substitute the point only after the differentiation is complete."
  ],
  [
    7,
    "inverse-function",
    "Derivative of an inverse",
    "(f⁻¹)′(b)=1/f′(a), b=f(a), f′(a)≠0",
    "An inverse reverses input and output near an invertible point.",
    "If f(2)=5 and f′(2)=3, then (f⁻¹)′(5)=1/3.",
    "Evaluate the original derivative at a, not b."
  ],
  [
    7,
    "log-differentiation",
    "Logarithmic differentiation",
    "For y>0, differentiate ln y then multiply by y",
    "Logs help when variables appear in both base and exponent.",
    "y=xˣ for x>0 gives ln y=x ln x; y′/y=ln x+1; y′=xˣ(ln x+1).",
    "State positivity assumptions before taking logarithms."
  ],
  [
    8,
    "related-rates",
    "Related rates",
    "Differentiate a relation with respect to time before inserting changing values",
    "Write one relationship among the changing quantities.",
    "A=πr² gives dA/dt=2πr dr/dt. At r=3 cm and dr/dt=2 cm/s, dA/dt=12π cm²/s.",
    "A snapshot value is not a constant throughout the motion."
  ],
  [
    8,
    "ladder",
    "Geometry in related rates",
    "x²+y²=L² ⇒ x dx/dt+y dy/dt=0 for fixed L",
    "Use signs to distinguish rising and falling quantities.",
    "A 5 m ladder has x=3 m, y=4 m, dx/dt=2 m/s. Thus dy/dt=−(3/4)·2=−3/2 m/s.",
    "The negative sign says the top is moving down."
  ],
  [
    8,
    "linearization",
    "Linear approximation",
    "L(x)=f(a)+f′(a)(x−a)",
    "Near a, the tangent approximates the function.",
    "For √x near 9: L(x)=3+(x−9)/6. Thus √9.12≈3.02.",
    "This is an approximation, not an exact identity; accuracy worsens farther from a."
  ],
  [
    8,
    "differentials",
    "Differentials and error estimates",
    "dy=f′(x)dx; Δy=f(x+Δx)−f(x)",
    "dy approximates the actual change for a small input change.",
    "A square of side 5 m measured with dx=0.01 m has estimated area change dA=2·5·0.01=0.1 m²; exact change is 0.1001 m².",
    "Use ≈ when replacing Δy with dy."
  ],
  [
    9,
    "mvt",
    "Rolle’s and Mean Value Theorems",
    "f′(c)=[f(b)−f(a)]/(b−a) for some c∈(a,b)",
    "Requires continuity on [a,b] and differentiability on (a,b). Rolle adds f(a)=f(b).",
    "For x² on [1,3], average slope=4. Since f′(c)=2c, c=2.",
    "Check the hypotheses; |x| on [−1,1] fails differentiability at 0."
  ],
  [
    9,
    "critical",
    "Critical points and monotonicity",
    "Critical numbers are domain points with f′=0 or f′ undefined",
    "The sign of f′ determines increasing and decreasing intervals.",
    "For f(x)=x³−3x, f′=3(x−1)(x+1). Increasing on (−∞,−1) and (1,∞); decreasing on (−1,1).",
    "A critical point need not be an extremum: x³ at 0 is an example."
  ],
  [
    9,
    "concavity",
    "Concavity and inflection",
    "f″>0 means concave up; f″<0 means concave down",
    "An inflection requires a change of concavity.",
    "For f(x)=x³, f″=6x changes sign at 0, so (0,0) is an inflection point.",
    "f″=0 alone does not prove an inflection; x⁴ at 0 is a counterexample."
  ],
  [
    9,
    "extrema",
    "Absolute extrema on a closed interval",
    "Compare f at critical numbers and endpoints",
    "A continuous function on a closed bounded interval attains both extrema.",
    "For x³−3x on [−2,2], values at −2,−1,1,2 are −2,2,−2,2. Maximum 2; minimum −2.",
    "Do not forget endpoints, ties, or points where the derivative fails."
  ],
  [
    10,
    "optimization",
    "Optimization setup",
    "Objective + constraint + feasible domain → one-variable function",
    "Model the quantity to optimize before differentiating.",
    "A rectangle with perimeter 20 has y=10−x and A=x(10−x), 0<x<10. A′=10−2x=0 at x=5; A″=−2<0; maximum area=25.",
    "State why the candidate is the global optimum over the feasible domain."
  ],
  [
    10,
    "open-box",
    "Optimization with boundaries",
    "V(x)=x(L−2x)(W−2x), 0<x<min(L,W)/2",
    "A box cut from a sheet must have positive dimensions.",
    "For a 12 by 12 sheet: V=x(12−2x)². V′=12(x−2)(x−6). Only x=2 lies in (0,6); V=128, and the boundary limits are 0.",
    "Discard algebraic roots outside the feasible domain."
  ],
  [
    10,
    "newton",
    "Newton’s method",
    "x_(n+1)=x_n−f(x_n)/f′(x_n), f′(x_n)≠0",
    "Tangent intersections give numerical root estimates; convergence is not guaranteed.",
    "For f=x²−2 and x₀=1.5: x₁=1.5−0.25/3=17/12≈1.41667.",
    "Check residuals and convergence; a near-zero derivative can produce a large jump."
  ],
  [
    10,
    "mixed",
    "Choosing a derivative application",
    "Identify the unknown: value, rate, optimum, or root",
    "The question determines the method.",
    "For s(t)=t², average velocity on [1,3] is 4; instantaneous velocity at 1 is 2; maximum position on [1,3] is 9.",
    "Do not choose a formula solely because a symbol looks familiar."
  ],
  [
    11,
    "antiderivatives",
    "Antiderivatives and constants",
    "∫xⁿ dx=x^(n+1)/(n+1)+C, n≠−1",
    "Indefinite integrals describe a family of functions on an interval.",
    "∫(6x²−4)dx=2x³−4x+C. Differentiate to check.",
    "The n=−1 case is ln|x|+C on intervals avoiding 0."
  ],
  [
    11,
    "initial-value",
    "Initial-value problems",
    "F′=f and F(a)=b determine the constant on an interval",
    "Use the initial condition after integrating.",
    "v(t)=6t and s(0)=4 give s(t)=3t²+C and C=4.",
    "If given acceleration, integrate twice and use two initial conditions."
  ],
  [
    11,
    "riemann",
    "Riemann sums",
    "Σ f(xᵢ*)Δx, Δx=(b−a)/n",
    "Sum signed rectangle areas to approximate accumulated change.",
    "For f=x on [0,2], n=4, right endpoints 0.5,1,1.5,2 give sum 0.5(0.5+1+1.5+2)=2.5; exact integral=2.",
    "Use n rectangles, not n+1, and include Δx."
  ],
  [
    11,
    "signed-area",
    "Definite integral and signed area",
    "∫ₐᵇf(x)dx = signed accumulation; ∫ₐᵇ|f(x)|dx = geometric area",
    "Negative outputs subtract from net accumulation.",
    "∫₋₁¹x dx=0, but ∫₋₁¹|x|dx=1 from two triangles of area 1/2.",
    "Distance uses |velocity|; displacement uses velocity."
  ],
  [
    12,
    "ftc-evaluate",
    "Fundamental Theorem: evaluation",
    "∫ₐᵇf(x)dx=F(b)−F(a) when F′=f and f is continuous",
    "An antiderivative converts accumulation into an endpoint difference.",
    "∫₀²3x² dx=[x³]₀²=8.",
    "Use upper minus lower; do not add an arbitrary C to a definite integral."
  ],
  [
    12,
    "ftc-derivative",
    "Fundamental Theorem: accumulation derivative",
    "d/dx ∫ₐ^(g(x)) f(t)dt=f(g(x))g′(x), for continuous f",
    "A varying upper endpoint contributes a chain-rule factor.",
    "d/dx ∫₁^(x²) cos t dt=2x cos(x²). Reversing the limits negates the integral.",
    "t is a dummy variable; do not confuse it with the upper endpoint x."
  ],
  [
    12,
    "substitution",
    "Integration by substitution",
    "u=g(x), du=g′(x)dx",
    "Substitution reverses the chain rule.",
    "∫2x cos(x²)dx: u=x², du=2x dx, giving sin(x²)+C. Differentiate to check.",
    "For definite integrals, transform both bounds into u values, or return to x before evaluating."
  ],
  [
    12,
    "integral-average",
    "Average value and net change",
    "f_avg=(1/(b−a))∫ₐᵇf(x)dx, b>a",
    "Average height differs from average rate of change.",
    "For f=x² on [0,3], integral=9 and average value=3. Average rate of change is also 3 here, but on [0,2] they are 4/3 and 2.",
    "Keep accumulated units, average-value units, and rate units distinct."
  ]
];
export const uahCalculusPack = {
  id: "uah-ma171", storageKey: "uah-ma171-v1", legacyKey: null,
  perFormula: 0, debtStart: 0, rewardsEnabled: false,
  brand: {title: "Micah’s Calculus Lab", logo: "∫", subtitle: "UAH MA 171 · Calculus I / Calculus A"},
  chapters: units.map(([name,group],i)=>({n:i+1,name,group,color:["#4F8CFF","#34D399","#A78BFA","#F5A623"][Math.floor(i/3)]})),
  groups: ["Foundations","Limits","Derivatives","Applications","Integrals"].map(key=>({key,label:key.toUpperCase()})),
  formulas: rows.map(([ch,key,name,formula,meaning,example,mathTip])=>({id:`ma171-${key}`,ch,name,formula,meaning,example,mathTip})),
  sources: courseSources,
  exams: [],
  tutor: {
    persona: "Coach", studentName: "Micah", subject: "single-variable calculus",
    course: "UAH MA 171 — Calculus I / Calculus A",
    textbook: "Instructor textbook unknown. OpenStax Calculus Volume 1 is optional further reading, not an assigned text.",
    mathNote: "Diagnose algebra and trig prerequisites as needed. Explain limits, derivatives and integrals conceptually, graphically and symbolically. Use radians. Show intermediate steps, hypotheses, domains, units and checks.",
    scheduleNote: "No instructor syllabus, assigned exercises, exam dates, grading weights or calculator policy has been supplied. Never invent them. Ask for the relevant course material when needed.",
    traps: ["A limit is not necessarily the function value.","Continuity does not imply differentiability.","Apply every chain-rule factor.","Check theorem hypotheses and optimization endpoints.","Distinguish signed integral from geometric area.","Include +C for indefinite integrals and transform substitution bounds.","One guided answer is not mastery."]
  },
  chatSeeds: ["Find my calculus starting point, one question at a time","Help me understand a limit before using rules","Walk me through the chain rule, then let me try","Help me set up a related-rates problem","Connect derivatives and integrals using the Fundamental Theorem","Give me mixed MA 171 practice without naming the method first"]
};
