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
void main(){ vec2 uv=gl_FragCoord.xy/u_resolution; float t=u_time*0.1+u_phase; float asp=u_resolution.x/u_resolution.y;
  vec2 src=vec2(-0.1,1.15); vec2 d=uv-src; float ang=atan(d.y,d.x);
  float beams=pow(0.5+0.5*sin(ang*22.0+t*0.6),6.0)*0.5+pow(0.5+0.5*sin(ang*9.0-t*0.3),4.0)*0.35;
  float fall=smoothstep(1.4,0.0,length(d)); float a=beams*fall*0.62;
  vec2 g=vec2(uv.x*asp,uv.y)*28.0+vec2(t*0.6,-t*0.4); vec2 id=floor(g); vec2 f=fract(g)-0.5;
  float h=hash(id); float mote=h>0.93?smoothstep(0.12,0.0,length(f-vec2(hash(id+2.0)-0.5,hash(id+5.0)-0.5)*0.6))*(0.5+0.5*sin(t*4.0+h*30.0)):0.0;
  a+=mote*1.2*fall; vec3 c=vec3(1.0,0.93,0.75); gl_FragColor=vec4(c*a,a); }
