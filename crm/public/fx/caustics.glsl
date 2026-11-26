precision highp float;
/** @resolution */
uniform vec2 u_resolution;
/** @time */
uniform float u_time;
/**
 * @label Deep water
 * @color
 * @default #0B6E68
 */
uniform vec3 u_deep;
/**
 * @label Light
 * @color
 * @default #9FF0E6
 */
uniform vec3 u_light;
/**
 * @label Scale
 * @range 1, 12
 * @default 5
 */
uniform float u_scale;
/**
 * @label Phase (for still renders)
 * @range 0, 20
 * @default 3
 */
uniform float u_phase;
// classic tileable water caustics (iterative)
void main(){
  vec2 uv = gl_FragCoord.xy / u_resolution.xy;
  float t = u_time * 0.35 + u_phase;
  vec2 p = mod(uv * u_scale * 6.28318, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 5; n++) {
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + tt) / inten), p.y / (cos(i.y + tt) / inten)));
  }
  c /= 5.0;
  c = 1.17 - pow(c, 1.4);
  float k = pow(abs(c), 8.0);
  vec3 col = mix(u_deep, u_light, clamp(k, 0.0, 1.0));
  col += 0.06 * (1.0 - uv.y);
  gl_FragColor = vec4(col, 1.0);
}
