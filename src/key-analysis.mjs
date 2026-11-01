// Pitch-class correlation using Krumhansl–Kessler major/minor profiles.
// Scores are similarities, not calibrated probabilities; relative keys can tie.
const MAJOR = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
const MINOR = [6.33,2.68,3.52,5.38,2.6,3.53,2.54,4.75,3.98,2.69,3.34,3.17];
const MAJOR_NAMES = ['C','Db','D','Eb','E','F','F#','G','Ab','A','Bb','B'];
const MINOR_NAMES = ['Cm','C#m','Dm','Ebm','Em','Fm','F#m','Gm','G#m','Am','Bbm','Bm'];
export const KEY_OPTIONS = [...MAJOR_NAMES, ...MINOR_NAMES];
export function rankKeys(chroma) {
  const total = chroma.reduce((s,n) => s+n,0), max = Math.max(...chroma);
  if (total < 1e-8 || chroma.filter(n => n > max * .08).length < 3) return null;
  const mean = total / 12, variance = chroma.reduce((s,n) => s+(n-mean)**2,0);
  if (variance < 1e-10) return null;
  const candidates=[];
  for (const minor of [false,true]) for (let root=0;root<12;root++) {
    const profile=minor?MINOR:MAJOR, pm=profile.reduce((s,n)=>s+n,0)/12;
    let numerator=0,pv=0;
    for(let i=0;i<12;i++){const p=profile[(i-root+12)%12]-pm;numerator+=(chroma[i]-mean)*p;pv+=p*p;}
    candidates.push({key:(minor?MINOR_NAMES:MAJOR_NAMES)[root],mode:minor?'단조':'장조',score:numerator/Math.sqrt(variance*pv)});
  }
  candidates.sort((a,b)=>b.score-a.score);
  const gap=candidates[0].score-candidates[1].score;
  return {...candidates[0], confidence:gap>.1?'보통 이상':gap>.035?'보통':'낮음', candidates:candidates.slice(0,3)};
}

function fft(re,im) {
  const n=re.length;
  for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];[im[i],im[j]]=[im[j],im[i]];}}
  for(let len=2;len<=n;len<<=1){const angle=-2*Math.PI/len,wr=Math.cos(angle),wi=Math.sin(angle);
    for(let offset=0;offset<n;offset+=len){let xr=1,xi=0;for(let k=0;k<len/2;k++){
      const a=offset+k,b=a+len/2,tr=xr*re[b]-xi*im[b],ti=xr*im[b]+xi*re[b];
      re[b]=re[a]-tr;im[b]=im[a]-ti;re[a]+=tr;im[a]+=ti;
      const next=xr*wr-xi*wi;xi=xr*wi+xi*wr;xr=next;
    }}
  }
}
export function estimateAudioKey(samples, sampleRate=22050) {
  const size=8192,hop=Math.max(size,Math.round(sampleRate*.5)),chroma=Array(12).fill(0);
  const re=new Float64Array(size),im=new Float64Array(size),mag=new Float64Array(size/2),window=Float64Array.from({length:size},(_,i)=>.5-.5*Math.cos(2*Math.PI*i/(size-1)));
  for(let pos=0;pos+size<=samples.length;pos+=hop){
    let energy=0;for(let i=0;i<size;i++){re[i]=samples[pos+i]*window[i];im[i]=0;energy+=re[i]**2;}
    if(energy/size<1e-8)continue;
    fft(re,im);for(let k=0;k<mag.length;k++)mag[k]=Math.hypot(re[k],im[k]);
    const frame=Array(12).fill(0),lo=Math.ceil(65*size/sampleRate),hi=Math.min(mag.length-2,Math.floor(2100*size/sampleRate));
    const peak=Math.max(...mag.subarray(lo,hi));
    for(let k=lo;k<hi;k++)if(mag[k]>peak*.05&&mag[k]>mag[k-1]&&mag[k]>=mag[k+1]){
      const a=Math.log(mag[k-1]+1e-12),b=Math.log(mag[k]+1e-12),c=Math.log(mag[k+1]+1e-12);
      const correction=.5*(a-c)/(a-2*b+c||1),frequency=(k+Math.max(-.5,Math.min(.5,correction)))*sampleRate/size;
      const pitch=69+12*Math.log2(frequency/440),nearest=Math.round(pitch);
      if(Math.abs(pitch-nearest)<.35)frame[((nearest%12)+12)%12]+=Math.sqrt(mag[k])/Math.sqrt(frequency/65);
    }
    const sum=frame.reduce((s,n)=>s+n,0);if(sum)for(let i=0;i<12;i++)chroma[i]+=frame[i]/sum;
  }
  return rankKeys(chroma);
}

export function keySignature(key='C') {
  const signatures={Cb:-7,Gb:-6,Db:-5,Ab:-4,Eb:-3,Bb:-2,F:-1,C:0,G:1,D:2,A:3,E:4,B:5,'F#':6,'C#':7,Abm:-7,Ebm:-6,Bbm:-5,Fm:-4,Cm:-3,Gm:-2,Dm:-1,Am:0,Em:1,Bm:2,'F#m':3,'C#m':4,'G#m':5,'D#m':6,'A#m':7};
  const count=signatures[key]??0,values={C:0,D:0,E:0,F:0,G:0,A:0,B:0};
  for(const letter of (count<0?'BEADGCF':'FCGDAEB').slice(0,Math.abs(count)))values[letter]=Math.sign(count);
  return {count,values};
}
