/**
 * ToxicOverlayPass — translucent green tint over toxic-zone tiles.
 *
 * Reads bit 15 (TOXIC_BIT) of the tile state texture and renders a soft,
 * per-tile pulsing overlay so players can see the 2-min ToxicMissile
 * zone. Renders above territory but below structures so structures stay
 * legible inside the zone.
 */

import type { RenderSettings } from "../RenderSettings";
import { createMapQuad, createProgram, shaderSrc } from "../utils/GlUtils";
import { TILE_DEFINES } from "../utils/TileCodec";

import overlayVertSrc from "../shaders/map-overlay/overlay.vert.glsl?raw";
import toxicFragSrc from "../shaders/toxic-overlay/toxic-overlay.frag.glsl?raw";

export class ToxicOverlayPass {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private tileTex: WebGLTexture;
  private settings: RenderSettings["toxicOverlay"];

  private uCamera: WebGLUniformLocation;
  private uMapSize: WebGLUniformLocation;
  private uTick: WebGLUniformLocation;
  private uColor: WebGLUniformLocation;
  private uAlphaBase: WebGLUniformLocation;
  private uAlphaPulse: WebGLUniformLocation;

  private mapW: number;
  private mapH: number;

  constructor(
    gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
    tileTex: WebGLTexture,
    settings: RenderSettings["toxicOverlay"],
  ) {
    this.gl = gl;
    this.mapW = mapW;
    this.mapH = mapH;
    this.tileTex = tileTex;
    this.settings = settings;

    this.program = createProgram(
      gl,
      overlayVertSrc,
      shaderSrc(toxicFragSrc, TILE_DEFINES),
    );

    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uMapSize = gl.getUniformLocation(this.program, "uMapSize")!;
    this.uTick = gl.getUniformLocation(this.program, "uTick")!;
    this.uColor = gl.getUniformLocation(this.program, "uColor")!;
    this.uAlphaBase = gl.getUniformLocation(this.program, "uAlphaBase")!;
    this.uAlphaPulse = gl.getUniformLocation(this.program, "uAlphaPulse")!;

    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uTileTex"), 0);

    this.vao = createMapQuad(gl, mapW, mapH);
  }

  draw(cameraMatrix: Float32Array, tick: number): void {
    const gl = this.gl;
    const s = this.settings;

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uMapSize, this.mapW, this.mapH);
    gl.uniform1f(this.uTick, tick);
    gl.uniform3f(this.uColor, s.colorR, s.colorG, s.colorB);
    gl.uniform1f(this.uAlphaBase, s.alphaBase);
    gl.uniform1f(this.uAlphaPulse, s.alphaPulse);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tileTex);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
  }
}
