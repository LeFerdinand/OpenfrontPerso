#version 300 es
precision highp float;

// Unit quad [0,1]
layout(location = 0) in vec2 aPos;
// Per-instance vec3: (centerX, centerY, radius)
layout(location = 1) in vec3 aInstancePos;
// Per-instance vec3: (kindCode, remainingFrac, _pad)
layout(location = 2) in vec3 aInstanceKind;

uniform mat3 uCamera;

out vec2 vLocal;          // [-1, +1] local coords
flat out float vRadius;
flat out float vKind;
flat out float vRemaining;

void main() {
  vLocal = aPos * 2.0 - 1.0;
  vRadius = aInstancePos.z;
  vKind = aInstanceKind.x;
  vRemaining = aInstanceKind.y;

  // Pad so we have room for soft edges + swirl tails.
  float padded = aInstancePos.z + 4.0;
  vec2 center = aInstancePos.xy + 0.5;
  vec2 worldPos = center + vLocal * padded;

  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
