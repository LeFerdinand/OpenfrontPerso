#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;

// Per-instance attributes
layout(location = 1) in vec3 aInstPos;   // x, y, ownerID
layout(location = 2) in vec2 aInstFlags; // atlasIdx (uint8→float), flags (uint8→float)
layout(location = 3) in float aAngle;    // [0,1] → multiplied by 2π in shader

uniform mat3  uCamera;

uniform float uUnitSize;

out vec2  vLocalPos;
out vec2  vAtlasUV;
flat out float vOwnerID;
flat out float vFlags;  // 0.0 = normal, 1.0 = flicker, 2.0 = angry
flat out float vHash;   // per-instance hash for flicker phase offset

void main() {
  float worldX = aInstPos.x;
  float worldY = aInstPos.y;
  vOwnerID = aInstPos.z;

  float atlasCol = aInstFlags.x;
  vFlags = aInstFlags.y;

  // Position-based hash so each unit flickers independently
  vHash = fract(worldX * 0.1731 + worldY * 0.3179);

  // UNIT_SIZE is in world-space tiles — no zoom division needed.
  // Units scale with the map like territory tiles do.
  float halfSize = uUnitSize * 0.5;

  vec2 center = vec2(worldX + 0.5, worldY + 0.5);
  // Local offset before rotation: aPos is in [0,1], shift to [-0.5, 0.5].
  vec2 local = (aPos - 0.5) * halfSize * 2.0;
  // Apply per-instance rotation around the quad center. aAngle is 0
  // for the vast majority of units (no rotation); planes set it to the
  // direction they're flying so the sprite "up" points that way.
  float theta = aAngle * 6.2831853;
  float c = cos(theta);
  float s = sin(theta);
  vec2 rotated = vec2(c * local.x - s * local.y, s * local.x + c * local.y);
  vec2 worldPos = center + rotated;

  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);

  vLocalPos = aPos;

  // Atlas UV: map quad [0,1] to the correct column. UV uses the
  // ORIGINAL (un-rotated) aPos so the sprite texture stays aligned
  // to the quad; the geometric rotation above is what gives the
  // visual "turning" effect.
  float colU = (atlasCol + aPos.x) / float(ATLAS_COLS);
  vAtlasUV = vec2(colU, aPos.y);
}
