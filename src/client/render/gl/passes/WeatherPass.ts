/**
 * WeatherPass — renders weather event overlays on top of the map.
 *
 * One instanced quad per active event:
 *   • fog       — soft-edged gray disc, alpha fades in/out around its
 *                 spawn / expiry.
 *   • earthquake — orange-red ring that pulses brightly while the
 *                  destruction tick is applied, then fades.
 *   • cyclone   — translucent blue swirl with a thin rotating ring
 *                 indicating motion.
 *
 * Drawn AFTER unit/structure passes so events occlude the world.
 */

import type { WeatherEventState } from "../../types";
import { DynamicInstanceBuffer } from "../DynamicBuffer";
import { createProgram } from "../utils/GlUtils";

import weatherFragSrc from "../shaders/weather/weather.frag.glsl?raw";
import weatherVertSrc from "../shaders/weather/weather.vert.glsl?raw";

// Per-instance: x, y, radius, kindCode, remaining, padding (vec3 + vec3 = 6 floats)
const FLOATS_PER_INSTANCE = 6;

/** Numeric codes mirrored in the fragment shader. */
const KIND_CODE: Record<WeatherEventState["kind"], number> = {
  fog: 0,
  earthquake: 1,
  cyclone: 2,
};

export class WeatherPass {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private instanceBuf: DynamicInstanceBuffer;
  private instanceCount = 0;

  private uCamera: WebGLUniformLocation;
  private uTime: WebGLUniformLocation;

  private startTime = performance.now();

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.program = createProgram(gl, weatherVertSrc, weatherFragSrc);
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uTime = gl.getUniformLocation(this.program, "uTime")!;

    // Shared unit quad
    const quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW,
    );

    const instanceGlBuf = gl.createBuffer()!;
    this.instanceBuf = new DynamicInstanceBuffer(
      gl,
      instanceGlBuf,
      64,
      FLOATS_PER_INSTANCE,
    );

    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Per-instance vec3 (x, y, radius)
    gl.bindBuffer(gl.ARRAY_BUFFER, instanceGlBuf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(
      1,
      3,
      gl.FLOAT,
      false,
      FLOATS_PER_INSTANCE * 4,
      0,
    );
    gl.vertexAttribDivisor(1, 1);

    // Per-instance vec3 (kind, remaining, _padding)
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(
      2,
      3,
      gl.FLOAT,
      false,
      FLOATS_PER_INSTANCE * 4,
      3 * 4,
    );
    gl.vertexAttribDivisor(2, 1);
    gl.bindVertexArray(null);
  }

  updateEvents(events: readonly WeatherEventState[]): void {
    this.instanceBuf.ensureCapacity(events.length);
    const f = this.instanceBuf.float32;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      const off = i * FLOATS_PER_INSTANCE;
      f[off + 0] = e.x;
      f[off + 1] = e.y;
      f[off + 2] = e.radius;
      f[off + 3] = KIND_CODE[e.kind];
      f[off + 4] = e.remaining;
      f[off + 5] = 0;
    }
    this.instanceCount = events.length;
    if (events.length > 0) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.instanceBuf.float32,
        0,
        events.length * FLOATS_PER_INSTANCE,
      );
    }
  }

  draw(cameraMatrix: Float32Array): void {
    if (this.instanceCount === 0) return;
    const gl = this.gl;
    const time = (performance.now() - this.startTime) / 1000;

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uTime, time);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.instanceCount);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
  }
}
