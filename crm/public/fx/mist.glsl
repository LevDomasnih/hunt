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
void main(){ vec2 uv=gl_FragCoord.xy/u_resolution; float t=u_time*0.05+u_phase;
  float n=fbm(vec2(uv.x*2.5+t, uv.y*6.0)); float n2=fbm(vec2(uv.x*1.5-t*0.7, uv.y*3.0+3.0));
  float band=smoothstep(0.65,0.25,uv.y)*smoothstep(0.0,0.2,uv.y);
  float a=clamp((n*0.9+n2*0.5-0.45),0.0,1.0)*band*1.15; gl_FragColor=vec4(vec3(0.97,0.98,1.0)*a,a); }
