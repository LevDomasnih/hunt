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
void main(){ vec2 uv=gl_FragCoord.xy/u_resolution; float t=u_time*0.3+u_phase; float asp=u_resolution.x/u_resolution.y;
  vec2 g=vec2(uv.x*asp*14.0, uv.y*14.0+t*4.0); vec2 id=floor(g); vec2 f=fract(g)-0.5; float h=hash(id); float a=0.0; vec3 c=vec3(0.0);
  if(h>0.8){ float r=t*3.0+h*20.0; mat2 m=mat2(cos(r),-sin(r),sin(r),cos(r)); vec2 q=m*(f-vec2(hash(id+3.0)-0.5,0.0)*0.5);
    float rect=step(abs(q.x),0.16)*step(abs(q.y),0.07*(0.4+0.6*abs(sin(r))));
    float k=hash(id+9.0); c=k<0.25?vec3(0.95,0.45,0.35):k<0.5?vec3(0.98,0.8,0.3):k<0.75?vec3(0.35,0.8,0.75):vec3(0.95,0.55,0.75); a=rect*0.85; }
  gl_FragColor=vec4(c*a,a); }
