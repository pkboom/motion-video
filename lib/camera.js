// Camera = piecewise smoothstep transitions between keyframes, evaluated in JS (overlay)
// and as an ffmpeg expression (zoom/pan pass) so both stay in sync.
export const sm = (p) => {
  p = Math.min(1, Math.max(0, p));
  return p * p * (3 - 2 * p);
};

export function makeCamera(kfs, init) {
  const at = (f) => {
    const v = { ...init };
    let prev = init;
    for (const k of kfs) {
      const p = sm((f - k.f) / k.d);
      v.z += (k.z - prev.z) * p;
      v.cx += (k.cx - prev.cx) * p;
      v.cy += (k.cy - prev.cy) * p;
      prev = k;
    }
    return v;
  };
  const expr = (key) => {
    let s = init[key].toFixed(5);
    let prev = init;
    for (const k of kfs) {
      const d = (k[key] - prev[key]).toFixed(5);
      prev = k;
      if (Number(d) === 0) continue;
      s += `+(st(0,clip((n/60-${k.f.toFixed(4)})/${k.d.toFixed(4)},0,1));ld(0)*ld(0)*(3-2*ld(0)))*(${d})`;
    }
    return s;
  };
  return { at, expr };
}
