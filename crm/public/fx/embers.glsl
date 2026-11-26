precision highp float;
/** @resolution */
uniform vec2 u_resolution;
/** @time */
uniform float u_time;
/**
 * @label Ember color
 * @color
 * @default #FFB04D
 */
uniform vec3 u_color;
/**
 * @label Density
 * @range 10, 80
 * @default 38
 */
uniform float u_density;
/**
 * @label Phase (still renders)
 * @range 0, 20
 * @default 4
 */
uniform float u_phase;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float t = u_time * 0.25 + u_phase;
  float acc = 0.0;
  // three layers of rising sparks with different speeds/sizes
  for (int L = 0; L < 3; L++) {
    float fl = float(L);
    float scale = u_density * (1.0 + fl * 0.6);
    vec2 g = vec2(uv.x * scale * (u_resolution.x / u_resolution.y), uv.y * scale * 0.6 - t * (1.5 + fl));
    vec2 id = floor(g); vec2 f = fract(g) - 0.5;
    float h = hash(id + fl * 13.0);
    if (h > 0.86) {
      vec2 o = vec2(hash(id + 1.7) - 0.5, hash(id + 3.1) - 0.5) * 0.6;
      o.x += 0.15 * sin(t * 3.0 + h * 20.0);
      float d = length(f - o);
      float r = 0.10 + 0.10 * hash(id + 9.0);
      float flicker = 0.6 + 0.4 * sin(t * 8.0 + h * 40.0);
      acc += smoothstep(r, 0.0, d) * flicker * (1.0 - fl * 0.25);
    }
  }
  acc *= smoothstep(1.0, 0.0, uv.y) * 1.2;      // sparks fade as they rise (uv.y = 0 at bottom)
  float glow = smoothstep(0.3, 0.0, uv.y) * 0.28; // warm haze near the bottom
  float a = clamp(acc * 2.4 + glow, 0.0, 0.95);
  vec3 col = mix(u_color, vec3(1.0, 0.95, 0.8), clamp(acc, 0.0, 1.0) * 0.6);
  gl_FragColor = vec4(col * a, a); // premultiplied
}
