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
void main(){ vec2 uv=gl_FragCoord.xy/u_resolution; float t=u_time*0.6+u_phase; float asp=u_resolution.x/u_resolution.y;
  float wave=0.5+0.5*sin(uv.x*12.0+t*1.5+fbm(uv*4.0+t*0.3)*4.0); float n=fbm(vec2(uv.x*8.0-t*0.5, uv.y*20.0));
  float foam=smoothstep(0.5,0.75,n*wave)*smoothstep(0.55,0.05,uv.y)*0.95;
  vec2 g=vec2(uv.x*asp,uv.y)*50.0; vec2 id=floor(g); float h=hash(id+floor(t*3.0)); float glint=(h>0.985?1.0:0.0)*smoothstep(0.6,0.1,uv.y)*smoothstep(0.35,0.0,length(fract(g)-0.5));
  float a=clamp(foam+glint,0.0,0.9); gl_FragColor=vec4(vec3(1.0)*a,a); }
