#version 300 es
precision highp float;

uniform sampler2D uVisTex;
uniform vec2 uMapSize;
uniform float uFogDarkAlpha; // alpha for never-explored ("black") fog
uniform float uFogGreyAlpha; // alpha for explored-but-not-visible ("memory") fog

in vec2 vWorldPos;
out vec4 fragColor;

void main() {
  vec2 uv = vWorldPos / uMapSize;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    fragColor = vec4(0.0, 0.0, 0.0, uFogDarkAlpha);
    return;
  }

  // Bilinear visibility sample with a 5-tap cross blur. The R8 texture
  // is uploaded with LINEAR filtering, so bilinear gives ~1 texel of
  // natural fade; sampling 4 neighbours widens that to ~4-5 screen
  // pixels regardless of zoom.
  vec2 texel = 1.0 / uMapSize;
  float v = texture(uVisTex, uv).r * 0.5;
  v += texture(uVisTex, uv + vec2(+texel.x, 0.0)).r * 0.125;
  v += texture(uVisTex, uv + vec2(-texel.x, 0.0)).r * 0.125;
  v += texture(uVisTex, uv + vec2(0.0, +texel.y)).r * 0.125;
  v += texture(uVisTex, uv + vec2(0.0, -texel.y)).r * 0.125;

  // Three-state visibility encoded in the input byte:
  //   v ~ 0.0  → never explored (dark fog)
  //   v ~ 0.5  → explored but not currently visible (grey "memory")
  //   v ~ 1.0  → currently visible (no fog)
  // Smoothsteps softly weight each band so transitions stay clean.
  float darkW  = 1.0 - smoothstep(0.15, 0.5, v);
  float clearW = smoothstep(0.5, 0.85, v);
  float greyW  = max(0.0, 1.0 - darkW - clearW);

  float alpha = darkW * uFogDarkAlpha + greyW * uFogGreyAlpha;
  fragColor = vec4(0.0, 0.0, 0.0, alpha);
}
