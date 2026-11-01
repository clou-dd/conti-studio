import { estimateAudioKey } from './key-analysis.mjs';
self.onmessage=({data})=>{
  try{self.postMessage({result:estimateAudioKey(data.samples,data.sampleRate)});}
  catch(error){self.postMessage({error:error.message});}
};
