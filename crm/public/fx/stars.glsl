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
void main(){ vec2 uv=gl_FragCoord.xy/u_resolution; float t=u_time+u_phase*3.0; float asp=u_resolution.x/u_resolution.y;
  vec2 g=vec2(uv.x*asp,uv.y)*60.0; vec2 id=floor(g); vec2 f=fract(g)-0.5; float h=hash(id);
  float a=0.0; if(h>0.9){ float tw=0.5+0.5*sin(t*(1.5+h*3.0)+h*50.0); a=smoothstep(0.18,0.0,length(f))*tw; }
  float ph=fract(t*0.07); vec2 s=vec2(0.2+ph*0.9,0.95-ph*0.5); vec2 dd=uv-s; dd.x*=asp;
  float along=dot(dd,normalize(vec2(-0.9*asp,0.5))); float across=abs(dd.x*0.5+dd.y*0.9);
  float shoot=smoothstep(0.004,0.0,across)*smoothstep(0.0,0.02,along)*smoothstep(0.18,0.02,along)*step(ph,0.35);
  a=clamp(a+shoot*0.9,0.0,1.0)*smoothstep(0.1,0.5,uv.y); gl_FragColor=vec4(vec3(1.0,0.98,0.92)*a,a); }
