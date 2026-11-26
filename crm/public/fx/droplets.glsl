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
void main(){ vec2 uv=gl_FragCoord.xy/u_resolution; float t=u_time*1.2+u_phase; float asp=u_resolution.x/u_resolution.y;
  vec2 g=vec2(uv.x*asp*40.0, uv.y*6.0+t*3.0); vec2 id=floor(g); vec2 f=fract(g); float h=hash(id); float a=0.0;
  if(h>0.85){ float x=abs(f.x-hash(id+2.0)); a=smoothstep(0.06,0.0,x)*smoothstep(0.0,0.3,f.y)*smoothstep(1.0,0.6,f.y)*0.95; }
  float mist=fbm(vec2(uv.x*3.0+t*0.1, uv.y*4.0-t*0.2))*smoothstep(0.5,0.0,uv.y)*0.8;
  a=clamp(a+mist,0.0,0.9); gl_FragColor=vec4(vec3(0.95,0.98,1.0)*a,a); }
