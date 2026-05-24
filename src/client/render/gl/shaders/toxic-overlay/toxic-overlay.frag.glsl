#version 300 es
precision highp float;
precision highp usampler2D;

uniform usampler2D uTileTex;  // R16UI — tile state per cell
uniform vec2  uMapSize;
uniform float uTick;
uniform vec3  uColor;
uniform float uAlphaBase;
uniform float uAlphaPulse;

in vec2 vWorldPos;
out vec4 fragColor;

// Hash for per-tile noise (matches stale-nuke pattern in territory.frag).
float hash21(vec2 p) {
  return fract(sin(p.x * 12.9898 + p.y * 78.233) * 43758.5453);
}

void main() {
  ivec2 tc = ivec2(floor(vWorldPos));
  if (tc.x < 0 || tc.y < 0 || tc.x >= int(uMapSize.x) || tc.y >= int(uMapSize.y))
    discard;

  uint raw = texelFetch(uTileTex, tc, 0).r;
  if ((raw & (1u << TOXIC_BIT)) == 0u) discard;

  // Subtle per-tile noise + slow breathing pulse so the zone feels alive
  // rather than a flat sticker. Pulse phase is offset per tile so the
  // entire zone shimmers asynchronously instead of pulsing in unison.
  float n = hash21(vec2(tc));
  float pulse = 0.5 + 0.5 * sin(uTick * 0.12 + n * 6.2831);
  float alpha = uAlphaBase + uAlphaPulse * pulse;

  // Mix the base toxic color with a slightly brighter highlight for variety.
  vec3 col = mix(uColor, uColor * 1.35, n * 0.5);

  fragColor = vec4(col, alpha);
}
