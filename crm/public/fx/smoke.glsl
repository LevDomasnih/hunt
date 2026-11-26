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
void main(){ vec2 uv=gl_FragCoord.xy/u_resolution; float t=u_time*0.12+u_phase;
  vec2 p=vec2(uv.x*2.0+sin(uv.y*6.0+t)*0.15, uv.y*1.5-t); float n=fbm(p*2.0+fbm(p+t)*1.5);
  float stem=smoothstep(0.25,0.0,abs(uv.x-0.5-0.1*sin(uv.y*8.0+t*2.0)))*smoothstep(0.9,0.0,uv.y);
  float a=clamp(smoothstep(0.5,0.85,n)*0.8+stem*smoothstep(0.45,0.8,n)*0.9,0.0,0.85)*smoothstep(1.0,0.2,uv.y);
  gl_FragColor=vec4(vec3(0.95,0.93,0.9)*a,a); }
