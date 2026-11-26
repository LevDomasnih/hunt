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
void main(){ vec2 uv=gl_FragCoord.xy/u_resolution; float t=floor((u_time+u_phase)*18.0);
  float g=hash(gl_FragCoord.xy+t)-0.5; float flick=0.03*sin(t*1.7); float vig=smoothstep(0.35,0.95,length(uv-0.5)*1.3);
  float dark=clamp(vig*0.45+flick,0.0,0.6); float light=clamp(g*0.22,0.0,0.2);
  float a=clamp(dark+abs(g)*0.12,0.0,0.7); vec3 c=vec3(light)/max(a,0.001); gl_FragColor=vec4(c*a,a); }
