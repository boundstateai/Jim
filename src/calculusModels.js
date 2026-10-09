/** Exact secant slope for x², avoiding cancellation when h is small. */
export function quadraticSlopes(a,h) {
  if (!Number.isFinite(a) || !Number.isFinite(h) || h===0) throw new RangeError("A nonzero finite step is required.");
  return {secant:2*a+h,tangent:2*a,point:a*a,nearby:(a+h)**2};
}
/** Right-endpoint sum for x² on [0,2]. This is a demonstration, not a general CAS. */
export function squareRiemann(n) {
  if (!Number.isInteger(n) || n<1 || n>1000) throw new RangeError("Use 1–1000 rectangles.");
  const width=2/n;
  const rectangles=Array.from({length:n},(_,i)=>({left:i*width,width,height:((i+1)*width)**2}));
  return {rectangles,sum:rectangles.reduce((s,r)=>s+r.width*r.height,0),exact:8/3};
}
