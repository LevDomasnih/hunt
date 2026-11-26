precision highp float;
/** @resolution */
uniform vec2 u_resolution;
/** @time */
uniform float u_time;
/**
 * @label Phase (still renders)
 * @range 0, 20
 * @default 3
 */
uniform float u_phase;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.0; a*=0.5; } return v; }
void main(){ vec2 uv=gl_FragCoord.xy/u_resolution; float t=u_time*0.15+u_phase;
  vec2 p=vec2(uv.x*3.0, uv.y*2.0 - t); float n=fbm(p+vec2(fbm(p+t*0.5),0.0));
  float col=smoothstep(0.48,0.8,n) * smoothstep(0.95,0.15,uv.y) * 0.85;
  gl_FragColor=vec4(vec3(1.0)*col, col); }
