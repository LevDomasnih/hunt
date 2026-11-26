precision highp float;
/** @resolution */
uniform vec2 u_resolution;
/** @time */
uniform float u_time;
/**
 * @label Warm
 * @color
 * @default #FF8FB1
 */
uniform vec3 u_a;
/**
 * @label Cool
 * @color
 * @default #7FE0D6
 */
uniform vec3 u_b;
/**
 * @label Phase (still renders)
 * @range 0, 20
 * @default 2
 */
uniform float u_phase;
float hash(float n){ return fract(sin(n) * 43758.5453); }
void main(){
  vec2 uv = gl_FragCoord.xy / u_resolution;
  float asp = u_resolution.x / u_resolution.y;
  float t = u_time * 0.12 + u_phase;
  vec3 col = vec3(0.0); float a = 0.0;
  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    vec2 c = vec2(hash(fi * 3.1), hash(fi * 7.7));
    c += 0.08 * vec2(sin(t + fi), cos(t * 0.8 + fi * 1.3));
    float r = 0.06 + 0.10 * hash(fi * 11.3);
    vec2 d = (uv - c); d.x *= asp;
    float disk = smoothstep(r, r * 0.75, length(d));
    float ring = smoothstep(r * 0.98, r * 0.9, length(d)) - smoothstep(r * 0.9, r * 0.82, length(d));
    vec3 tint = mix(u_a, u_b, hash(fi * 5.9));
    float w = (0.18 + 0.25 * hash(fi * 2.3)) * (disk + ring * 0.6);
    col += tint * w; a += w;
  }
  vec3 c = col / max(a, 0.001);
  float aa = clamp(a * 1.1, 0.0, 0.5);
  gl_FragColor = vec4(c * aa, aa); // premultiplied
}
