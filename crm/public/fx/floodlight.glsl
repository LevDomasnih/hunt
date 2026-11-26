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
void main(){ vec2 uv=gl_FragCoord.xy/u_resolution; float t=u_time*0.4+u_phase; float asp=u_resolution.x/u_resolution.y; float a=0.0;
  // floodlight flares at the top corners + a ball streak
  for(int i=0;i<2;i++){ vec2 c=vec2(i==0?0.12:0.88,0.92); vec2 d=uv-c; d.x*=asp; float r=length(d);
    float core=smoothstep(0.08,0.0,r); float halo=exp(-r*6.0)*0.35; float star=exp(-abs(d.y)*90.0)*exp(-abs(d.x)*4.0)*0.35+exp(-abs(d.x)*90.0)*exp(-abs(d.y)*4.0)*0.25;
    a+=core+halo+star*(0.8+0.2*sin(t*3.0+float(i))); }
  float p=fract(t*0.25); vec2 b=vec2(0.15+p*0.7,0.35+0.25*sin(p*3.14159)); vec2 db=uv-b; db.x*=asp;
  float ball=smoothstep(0.018,0.0,length(db)); float trail=smoothstep(0.012,0.0,abs(db.y+db.x*0.0))*smoothstep(0.0,-0.15,db.x)*smoothstep(-0.15,0.0,db.x)*0.4;
  a=clamp(a*0.6+ball+trail,0.0,0.9); vec3 col=mix(vec3(1.0,0.97,0.88),vec3(0.85,1.0,0.4),ball); gl_FragColor=vec4(col*a,a); }
