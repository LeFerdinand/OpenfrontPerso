/**
 * FogOfWarPass — black overlay that hides tiles outside the local player's
 * vision. Used only in singleplayer when the `fogOfWar` config flag is set.
 *
 * Visibility is computed CPU-side by the frame builder and uploaded as an
 * R8 texture (255 = visible, 0 = hidden). The fragment shader samples that
 * texture with LINEAR filtering plus a small neighborhood blur to give a
 * soft ~5-pixel transition between visible and hidden regions.
 *
 * Drawn LAST in the overlay pipeline so it darkens everything underneath
 * (terrain, territory, borders, units, structures, names) — covering
 * enemy info naturally with no per-pass filtering.
 */

import {
  createMapQuad,
  createProgram,
  createTexture2D,
} from "../utils/GlUtils";

import fogFragSrc from "../shaders/fog-of-war/fog-of-war.frag.glsl?raw";
import overlayVertSrc from "../shaders/map-overlay/overlay.vert.glsl?raw";

export class FogOfWarPass {
  private gl: WebGL2RenderingContext;
  private mapW: number;
  private mapH: number;

  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private visTex: WebGLTexture;

  private uCamera: WebGLUniformLocation;
  private uMapSize: WebGLUniformLocation;
  private uFogDarkAlpha: WebGLUniformLocation;
  private uFogGreyAlpha: WebGLUniformLocation;

  private enabled = false;
  /** Darkness of never-explored areas (0 = no fog, 1 = pitch black). */
  private fogDarkAlpha = 1.0;
  /** Darkness of explored-but-not-visible "memory" areas. */
  private fogGreyAlpha = 0.45;

  constructor(gl: WebGL2RenderingContext, mapW: number, mapH: number) {
    this.gl = gl;
    this.mapW = mapW;
    this.mapH = mapH;

    this.program = createProgram(gl, overlayVertSrc, fogFragSrc);
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uMapSize = gl.getUniformLocation(this.program, "uMapSize")!;
    this.uFogDarkAlpha = gl.getUniformLocation(this.program, "uFogDarkAlpha")!;
    this.uFogGreyAlpha = gl.getUniformLocation(this.program, "uFogGreyAlpha")!;

    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uVisTex"), 0);

    this.vao = createMapQuad(gl, mapW, mapH);

    // Start with a fully-visible texture so the very first draw before any
    // visibility upload looks identical to fog-disabled.
    const initial = new Uint8Array(mapW * mapH).fill(255);
    this.visTex = createTexture2D(gl, {
      width: mapW,
      height: mapH,
      internalFormat: gl.R8,
      format: gl.RED,
      type: gl.UNSIGNED_BYTE,
      data: initial,
      filter: gl.LINEAR,
    });
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Upload a fresh visibility buffer of length mapW * mapH (R8). */
  updateVisibility(visibility: Uint8Array): void {
    if (visibility.length !== this.mapW * this.mapH) {
      console.warn(
        `FogOfWarPass: visibility size ${visibility.length} != expected ${
          this.mapW * this.mapH
        }`,
      );
      return;
    }
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.visTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      this.mapW,
      this.mapH,
      gl.RED,
      gl.UNSIGNED_BYTE,
      visibility,
    );
  }

  draw(cameraMatrix: Float32Array): void {
    if (!this.enabled) return;

    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uMapSize, this.mapW, this.mapH);
    gl.uniform1f(this.uFogDarkAlpha, this.fogDarkAlpha);
    gl.uniform1f(this.uFogGreyAlpha, this.fogGreyAlpha);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.visTex);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.visTex);
  }
}
