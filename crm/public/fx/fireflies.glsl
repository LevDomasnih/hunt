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
void main(){ vec2 uv=gl_FragCoord.xy/u_resolution; float t=u_time*0.4+u_phase; float asp=u_resolution.x/u_resolution.y; float a=0.0;
  for(int i=0;i<18;i++){ float fi=float(i); vec2 c=vec2(hash(vec2(fi,1.0)),hash(vec2(fi,7.0))*0.7);
    c+=0.05*vec2(sin(t+fi*1.7),cos(t*0.8+fi)); vec2 d=uv-c; d.x*=asp; float blink=pow(0.5+0.5*sin(t*2.0+fi*4.1),3.0);
    a+=smoothstep(0.03,0.0,length(d))*blink+smoothstep(0.09,0.0,length(d))*blink*0.25; }
  a=clamp(a,0.0,1.0); gl_FragColor=vec4(vec3(0.85,1.0,0.45)*a,a); }
