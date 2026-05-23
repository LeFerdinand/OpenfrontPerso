#version 300 es
precision highp float;

in vec2 vLocal;
flat in float vRadius;
flat in float vKind;
flat in float vRemaining;

uniform float uTime;

out vec4 fragColor;

// Kind codes — keep in sync with WeatherPass.ts
const float KIND_FOG = 0.0;
const float KIND_QUAKE = 1.0;
const float KIND_CYCLONE = 2.0;

void main() {
  float padded = vRadius + 4.0;
  vec2 local = vLocal * padded;
  float dist = length(local);

  if (dist > vRadius + 4.0) discard;

  // Soft envelope at the start + end of the event lifetime so storms
  // breathe in/out rather than blinking.
  float fadeIn = smoothstep(0.95, 0.7, vRemaining);
  float fadeOut = smoothstep(0.0, 0.25, vRemaining);
  float life = fadeIn * fadeOut;

  vec3 color = vec3(0.0);
  float alpha = 0.0;

  if (vKind < KIND_QUAKE) {
    // ── FOG ──────────────────────────────────────────────────────────────
    // Soft gray disc. Density ramps up toward the center but never opaque.
    float core = 1.0 - smoothstep(0.0, vRadius, dist);
    // Subtle swirl noise to break the perfect circle.
    float swirl = 0.5 + 0.5 * sin(dist * 0.4 - uTime * 0.6 + atan(local.y, local.x) * 3.0);
    color = mix(vec3(0.65), vec3(0.85), swirl * 0.4);
    alpha = core * 0.55 * life;

  } else if (vKind < KIND_CYCLONE) {
    // ── EARTHQUAKE ────────────────────────────────────────────────────────
    // Hot ring with shake — driven by a high-frequency jitter on the
    // radius so it looks like the ground is moving.
    float jitter = 0.6 * sin(uTime * 60.0 + dist * 1.7);
    float r = vRadius + jitter;
    float ring = smoothstep(r - 2.0, r - 0.5, dist)
               * (1.0 - smoothstep(r + 0.5, r + 2.0, dist));
    float glow = (1.0 - smoothstep(0.0, vRadius, dist)) * 0.35;
    color = mix(vec3(1.0, 0.45, 0.1), vec3(1.0, 0.9, 0.4), ring);
    alpha = clamp(ring + glow, 0.0, 1.0) * (0.55 + 0.45 * vRemaining);

  } else {
    // ── CYCLONE ───────────────────────────────────────────────────────────
    // Spiral arms rotating around the eye. Three-armed Archimedean spiral
    // sampled by polar coords.
    float a = atan(local.y, local.x);
    float r01 = dist / vRadius;
    // Eye = transparent calm. Walls = strongest opacity.
    float wall = smoothstep(0.05, 0.45, r01) * (1.0 - smoothstep(0.85, 1.0, r01));
    float spiral = 0.5 + 0.5 * cos(3.0 * a + r01 * 12.0 - uTime * 3.5);
    // Thin outer ring marking the storm boundary.
    float ring = smoothstep(vRadius - 1.5, vRadius - 0.5, dist)
               * (1.0 - smoothstep(vRadius + 0.5, vRadius + 1.5, dist));
    color = mix(vec3(0.25, 0.55, 0.95), vec3(0.85, 0.95, 1.0), spiral);
    alpha = (wall * spiral * 0.6 + ring * 0.9) * life;
  }

  if (alpha < 0.01) discard;
  fragColor = vec4(color, alpha);
}
