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
void main(){ vec2 uv=gl_FragCoord.xy/u_resolution; float t=u_time*0.5+u_phase; float asp=u_resolution.x/u_resolution.y;
  // two slow neon light sweeps (pink, cyan) + sparse light leaks
  float s1=exp(-pow((uv.x+uv.y*0.4-fract(t*0.15)*1.8+0.4)*5.0,2.0));
  float s2=exp(-pow((uv.x-uv.y*0.5-fract(t*0.11+0.5)*1.8+0.2)*6.0,2.0));
  float pulse=0.75+0.25*sin(t*2.2);
  vec3 c=vec3(1.0,0.35,0.7)*s1*0.35*pulse+vec3(0.3,0.9,1.0)*s2*0.3*pulse;
  vec2 g=vec2(uv.x*asp,uv.y)*24.0; vec2 id=floor(g); float h=hash(id);
  float spark=h>0.97?smoothstep(0.2,0.0,length(fract(g)-0.5))*(0.5+0.5*sin(t*5.0+h*40.0)):0.0;
  c+=vec3(1.0,0.8,0.95)*spark*0.6; float a=clamp(max(max(c.r,c.g),c.b),0.0,0.7);
  gl_FragColor=vec4(c,a); }
