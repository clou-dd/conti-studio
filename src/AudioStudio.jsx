import React, { useEffect, useRef, useState } from 'react';
import ABCJS from 'abcjs';
import { X, Loader2, Upload, Play, Square, Music2, Scissors, Plus, Trash2, Check, ExternalLink, ArrowRight } from 'lucide-react';
import { youtubeId, uid } from './model.mjs';
import { interludeAbc } from './render.js';
import { audioBase, audioWav, captureTab, decodeAudio, transcribeClip } from './audio.js';
import { demoAudio, notesToDraft, sectionsToForm, timeLabel } from './audio-core.mjs';
import './audio.css';

function Notation({ block, onError }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!block) return;
    try {
      const tunes = ABCJS.renderAbc(ref.current, interludeAbc(block), { responsive: 'resize', staffwidth: 650, add_classes: true });
      const warning = tunes[0]?.warnings?.[0];
      onError(warning ? '음표 표기를 확인해 주세요. 수정 후 미리보기가 갱신됩니다.' : '');
    } catch (error) { ref.current.replaceChildren(); onError(error.message); }
  }, [block, onError]);
  return <div ref={ref} className="audio-notation" aria-label="수정 중인 간주 악보 미리보기" />;
}

export default function AudioStudio({ song, onClose, onApplyForm, onApplyScore }) {
  const [url, setUrl] = useState(song.url), [step, setStep] = useState(0), [audio, setAudio] = useState(null), [audioUrl, setAudioUrl] = useState('');
  const [sections, setSections] = useState(song.analysis?.sections || []), [bpm, setBpm] = useState(song.analysis?.bpm || 0), [bpmInput, setBpmInput] = useState('');
  const [meter, setMeter] = useState('4/4'), [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [recording, setRecording] = useState(false), [recordSeconds, setRecordSeconds] = useState(0);
  const [clipStart, setClipStart] = useState(0), [clipEnd, setClipEnd] = useState(8), [draft, setDraft] = useState(null), [notationError, setNotationError] = useState('');
  const [wholeDrafts, setWholeDrafts] = useState([]), [draftIndex, setDraftIndex] = useState(0);
  const input = useRef(), player = useRef(), capture = useRef(), worker = useRef(), active = useRef(true), generation = useRef(0), stopRef = useRef(), playbackEnd = useRef(null);
  const root = useRef(), operation = useRef(false), captureWanted = useRef(false);
  const transcription = useRef(null), cancelAnalysis = useRef(null);
  const supported = !!navigator.mediaDevices?.getDisplayMedia;
  const id = youtubeId(url);
  useEffect(() => {
    const previous = document.activeElement; root.current.focus();
    const handler = e => {
      if (e.key === 'Escape' && !operation.current && !captureWanted.current) onClose();
      if (e.key !== 'Tab') return;
      const elements = [...root.current.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select,textarea,audio')].filter(x => x.getClientRects().length);
      if (!elements.length) return;
      if (e.shiftKey && (document.activeElement === elements[0] || document.activeElement === root.current)) { e.preventDefault(); elements.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === elements.at(-1)) { e.preventDefault(); elements[0].focus(); }
    };
    document.addEventListener('keydown', handler);
    return () => { active.current = false; generation.current++; captureWanted.current = false; capture.current?.cancel(); cancelAnalysis.current?.(); transcription.current?.abort(); document.removeEventListener('keydown', handler); previous?.focus(); };
  }, []);
  useEffect(() => {
    if (!audio) return;
    const next = URL.createObjectURL(audioWav(audio.samples, audio.sampleRate)); setAudioUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [audio]);
  function receiveAudio(next) {
    if (!active.current) return;
    if (next.duration < 3) throw new Error('3초 이상의 소리를 가져와 주세요.');
    playbackEnd.current = null; setError(''); setAudio(next); setSections([]); setDraft(null); setWholeDrafts([]); setBpm(0); setBpmInput(''); setClipStart(0); setClipEnd(Math.min(8, next.duration)); setNotice('소리를 가져왔습니다. 송폼 분석을 실행해 주세요.');
  }
  async function perform(fn) {
    if (operation.current) return;
    operation.current = true; setError(''); setNotice('');
    const version = ++generation.current;
    try { await fn(version); } catch (e) { if (active.current && version === generation.current) setError(e.message || '작업을 완료하지 못했습니다.'); }
    finally { if (active.current && version === generation.current) { setBusy(''); operation.current = false; } }
  }
  async function stopCapture() {
    if (!capture.current) return;
    const current = capture.current; capture.current = null; captureWanted.current = false;
    setRecording(false); setBusy('소리 정리 중…');
    try { const next = await current.stop(); if (next) receiveAudio(next); }
    catch (e) { if (active.current) setError(e.message); }
    finally { if (active.current) setBusy(''); }
  }
  stopRef.current = stopCapture;
  async function beginCapture() {
    if (operation.current || captureWanted.current) return;
    captureWanted.current = true; setBusy('공유할 탭을 선택해 주세요.'); setError(''); setNotice('');
    try {
      const session = await captureTab(seconds => { if (active.current) setRecordSeconds(seconds); }, () => stopRef.current());
      if (!active.current || !captureWanted.current) { await session.cancel(); return; }
      capture.current = session; setRecording(true); setRecordSeconds(0);
    } catch (e) { captureWanted.current = false; if (active.current) setError(e.message); }
    finally { if (active.current) setBusy(''); }
  }
  function cancel() {
    generation.current++; cancelAnalysis.current?.(); transcription.current?.abort(); worker.current = null;
    operation.current = false; setBusy(''); setNotice('분석을 중단했습니다. 입력한 내용은 유지됩니다.');
  }
  async function analyze() {
    if (!audio) return;
    if (bpmInput && (!Number.isFinite(Number(bpmInput)) || Number(bpmInput) < 40 || Number(bpmInput) > 240)) { setError('BPM은 40~240 사이로 입력해 주세요.'); return; }
    await perform(async version => {
      setBusy('송폼 분석 준비 중…');
      const result = await new Promise((resolve, reject) => {
        const w = new Worker(new URL('./structure.worker.js', import.meta.url), { type: 'module' }); worker.current = w;
        const timer = setTimeout(() => { w.terminate(); worker.current = null; cancelAnalysis.current = null; reject(new Error('분석 시간이 길어 중단했습니다. 짧은 음원이나 다른 브라우저로 다시 시도해 주세요.')); }, 180000);
        cancelAnalysis.current = () => { clearTimeout(timer); w.terminate(); reject(new Error('분석을 중단했습니다.')); cancelAnalysis.current = null; };
        w.onmessage = ({ data }) => {
          if (!active.current || version !== generation.current) return;
          if (data.progress) setBusy(data.progress);
          else { clearTimeout(timer); w.terminate(); worker.current = null; cancelAnalysis.current = null; data.error ? reject(new Error(data.error)) : resolve(data.result); }
        };
        w.onerror = () => { clearTimeout(timer); w.terminate(); worker.current = null; cancelAnalysis.current = null; reject(new Error('송폼 모델을 실행하지 못했습니다. 네트워크 연결과 브라우저를 확인해 주세요.')); };
        const samples = audio.samples.slice();
        w.postMessage({ samples, sampleRate: audio.sampleRate, bpm: Number(bpmInput) || 0, base: audioBase() }, [samples.buffer]);
      });
      if (!active.current || version !== generation.current) return;
      setSections(result.sections.map(s => ({ ...s, id: uid() }))); setBpm(result.bpm); setDraft(null); setStep(1);
      const inter = result.sections.find(s => s.label === 'Inter');
      if (inter) { setClipStart(inter.start); setClipEnd(Math.min(inter.end, inter.start + 60)); }
      setNotice('송폼 초안이 생성되었습니다. 구간 이름과 경계를 확인해 주세요.');
    });
  }
  function boundary(index, value) {
    if (!Number.isFinite(value)) return;
    setSections(current => {
      const next = current.map(s => ({ ...s }));
      if (index >= next.length - 1) return current;
      const time = Math.max(next[index].start + .25, Math.min(next[index + 1].end - .25, value));
      next[index].end = time; next[index + 1].start = time; return next;
    });
  }
  function split(index) {
    const s = sections[index]; if (s.end - s.start < 1 || sections.length >= 200) return;
    const middle = Math.round((s.start + s.end) * 50) / 100;
    setSections(current => [...current.slice(0, index), { ...s, end: middle }, { ...s, id: uid(), start: middle }, ...current.slice(index + 1)]);
  }
  function remove(index) {
    if (sections.length < 2) return;
    setSections(current => {
      const next = current.map(s => ({ ...s }));
      if (index) next[index - 1].end = next[index].end;
      else next[1].start = next[0].start;
      next.splice(index, 1); return next;
    });
  }
  function listen(start, end) {
    if (!player.current) return;
    playbackEnd.current = end; player.current.currentTime = start;
    player.current.play().catch(() => setError('재생 버튼을 눌러 음원을 들어 주세요.'));
  }
  async function transcribe() {
    if (!audio) return;
    const start = Number(clipStart), end = Number(clipEnd), tempo = Number(bpmInput) || bpm || 120;
    if (tempo < 40 || tempo > 240 || !Number.isFinite(tempo)) { setError('BPM은 40~240 사이로 입력해 주세요.'); return; }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > audio.duration || end - start < 1 || end - start > 60) { setError('간주 구간은 음원 안에서 1~60초로 선택해 주세요.'); return; }
    if ((end - start) * tempo / 60 / (Number(meter.split('/')[0]) * 4 / Number(meter.split('/')[1])) > 32) { setError('추가 악보는 32마디까지 지원합니다. 구간을 더 짧게 선택해 주세요.'); return; }
    await perform(async version => {
      setBusy('간주 채보 모델 준비 중…');
      setWholeDrafts([]);
      const clip = audio.samples.slice(Math.floor(start * audio.sampleRate), Math.floor(end * audio.sampleRate));
      const controller = new AbortController(); transcription.current = controller;
      let events;
      try { events = await transcribeClip(clip, progress => { if (active.current && version === generation.current) setBusy(progress); }, controller.signal, { sampleRate: audio.sampleRate }); }
      finally { if (transcription.current === controller) transcription.current = null; }
      if (!active.current || version !== generation.current) return;
      const result = notesToDraft(events, { bpm: tempo, duration: end - start, meter });
      if (!result.noteCount) throw new Error('이 구간에서 채보할 음표를 찾지 못했습니다. 구간을 바꾸거나 악기 음원이 더 선명한 파일을 사용해 주세요.');
      setDraft({ title: `Interlude · ${timeLabel(start)}–${timeLabel(end)}`, key: 'C', meter, mode: 'melody', notes: result.notes, chords: result.chords, note: `자동 채보 초안 · ♩=${Math.round(tempo)} · 음정·리듬·코드를 확인해 주세요.` });
      setNotice('간주 악보 초안이 생성되었습니다. 재생하며 음표와 코드를 수정해 주세요.');
    });
  }
  const labels = ['Intro', 'A', 'B', 'C', 'Inter', 'Out', '쉼'];
  const forms = sectionsToForm(sections, Number(bpmInput) || bpm || 120, Number(meter.split('/')[0]) * 4 / Number(meter.split('/')[1]));
  const patchDraft = fields => {
    setDraft(current => ({ ...current, ...fields }));
    if (wholeDrafts.length) setWholeDrafts(current => current.map((d, i) => i === draftIndex ? { ...d, ...fields } : d));
  };
  async function transcribeWhole() {
    if (!audio) return;
    const tempo = Number(bpmInput) || bpm || 120;
    if (!Number.isFinite(tempo) || tempo < 40 || tempo > 240) { setError('BPM은 40~240 사이로 입력해 주세요.'); return; }
    await perform(async version => {
      setBusy('전체 곡 채보 준비 중…');
      const controller = new AbortController(); transcription.current = controller;
      let result;
      try { result = await transcribeClip(audio.samples.slice(), progress => { if (active.current && version === generation.current) setBusy(progress); }, controller.signal, { whole: true, bpm: tempo, meter, sampleRate: audio.sampleRate }); }
      finally { if (transcription.current === controller) transcription.current = null; }
      if (!active.current || version !== generation.current) return;
      const blocks = result.map((r, i) => ({ title: `전체 채보 ${String(i + 1).padStart(2, '0')} · ${timeLabel(r.start)}–${timeLabel(r.end)}`, key: 'C', meter, mode: 'melody', notes: r.notes, chords: r.chords, note: `전체 곡 채보 초안 · ♩=${Math.round(tempo)} · 음정·리듬·코드를 확인해 주세요.` }));
      setWholeDrafts(blocks); setDraftIndex(0); setDraft(blocks[0]);
      setNotice(`전체 곡을 ${blocks.length}개 악보로 나누어 채보했습니다. 구간별로 수정한 뒤 콘티에 추가하세요.`);
    });
  }
  function addAllDrafts() {
    try {
      for (const d of wholeDrafts) interludeAbc(d);
      if (onApplyScore(wholeDrafts, url) !== false) setNotice(`${wholeDrafts.length}개 악보를 콘티에 추가했습니다. 편집기에서 위치를 바꿀 수 있습니다.`);
    } catch (e) { setError(e.message); }
  }
  function applyForm() {
    const tempo = Number(bpmInput) || bpm;
    if (!Number.isFinite(tempo) || tempo < 40 || tempo > 240 || sections.some(s => !s.label.trim()) || !forms.length) { setError('구간 이름과 BPM(40~240)을 확인해 주세요.'); return; }
    onApplyForm({ url, bpm: tempo, sections }, forms); setNotice('현재 찬양의 송폼을 이 초안으로 교체했습니다.');
  }
  return <div className="modal-backdrop"><section ref={root} tabIndex={-1} className="modal audio-studio" role="dialog" aria-modal="true" aria-label="음원 분석 스튜디오">
    <div className="modal-head"><div><span className="audio-eyebrow">AUDIO STUDIO · BETA</span><h2>듣고, 나누고, 악보로.</h2><p>{song.title} · 분석 결과를 확인하고 콘티에 적용하세요.</p></div><button className="icon-button" aria-label="음원 분석 닫기" disabled={!!busy || recording} onClick={onClose}><X size={21}/></button></div>
    <nav className="audio-steps" aria-label="음원 분석 단계">{['음원 연결', '송폼 확인·수정', '악보 채보·수정'].map((text, i) => <button key={text} className={step === i ? 'active' : ''} disabled={!!busy || recording} onClick={() => setStep(i)}><span>{i + 1}</span>{text}</button>)}</nav>
    <div className="audio-body">
      {error && <div className="audio-message error" role="alert">{error}</div>}{notice && <div className="audio-message" role="status">{notice}</div>}
      {busy && <div className="audio-progress" role="status"><Loader2 size={19} className="spin"/><span>{busy}</span>{(worker.current || transcription.current) && <button className="text-button" onClick={cancel}>중단</button>}</div>}
      {step === 0 && <div className="audio-input-layout"><div className="audio-source"><label className="field">유튜브 링크<input aria-label="분석할 유튜브 링크" value={url} maxLength={2000} placeholder="https://youtu.be/xITJZa0hpu0" disabled={recording || !!busy} onChange={e => setUrl(e.target.value)}/></label>
        {id ? <><div className="audio-video"><iframe title="분석 참고 유튜브 영상" src={`https://www.youtube-nocookie.com/embed/${id}`} allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin"/></div><a href={`https://www.youtube.com/watch?v=${id}`} target="_blank" rel="noreferrer" className="text-button">유튜브 탭으로 열기<ExternalLink size={13}/></a></> : <div className="audio-video-placeholder"><Music2 size={36}/><p>분석할 유튜브 링크를 넣어 주세요.</p></div>}
        <div className="audio-capture-actions">{recording ? <button className="button recording" onClick={stopCapture}><Square size={15}/>가져오기 완료 · {timeLabel(recordSeconds)}</button> : <button className="button primary" disabled={!supported || !!busy || !id} onClick={beginCapture}>탭 소리 연결</button>}</div>
      </div><div className="audio-guide"><span className="pill">서버 업로드 없이 브라우저에서 처리</span><h3>유튜브를 재생하면서<br/>소리를 가져옵니다.</h3><ol><li>‘탭 소리 연결’을 누릅니다.</li><li>유튜브가 재생되는 탭을 선택하고 <strong>탭 오디오 공유</strong>를 켭니다.</li><li>영상을 처음부터 재생한 후 ‘가져오기 완료’를 누릅니다.</li></ol><p>곡 길이만큼 재생 시간이 필요합니다. 시간 표시는 가져온 소리를 기준으로 하므로 재생 전 대기 시간도 포함될 수 있습니다.</p>{!supported && <p className="audio-unsupported">이 브라우저에서는 탭 소리를 가져올 수 없습니다. PC Chrome·Edge에서 열거나 음원 파일을 선택해 주세요.</p>}
        <div className="audio-alternative"><input ref={input} type="file" accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg,.webm" hidden onChange={e => { const file = e.target.files[0]; e.target.value = ''; if (file) perform(async () => { setBusy('음원 파일 불러오는 중…'); receiveAudio(await decodeAudio(file)); }); }}/><button className="button" disabled={!!busy || recording} onClick={() => input.current.click()}><Upload size={16}/>음원 파일 선택</button><button className="text-button" disabled={!!busy || recording} onClick={() => { receiveAudio(demoAudio()); setBpmInput('120'); }}>합성 음원으로 기능 체험<ArrowRight size={13}/></button><small>음원 파일은 50MB·10분까지 지원합니다. 합성 음원은 기능 확인용 소리입니다.</small></div>
      </div></div>}
      {audio && <section className="audio-player"><div><strong>{audio.name}</strong><span>{timeLabel(audio.duration)} · 원본 음원은 이 창을 닫을 때 해제됩니다.</span></div><audio ref={player} src={audioUrl || undefined} controls onTimeUpdate={e => { if (playbackEnd.current != null && e.currentTarget.currentTime >= playbackEnd.current) { e.currentTarget.pause(); playbackEnd.current = null; } }}/></section>}
      {step < 2 && <div className="audio-analysis-control"><label className="field">BPM 보정 <input type="number" aria-label="분석 BPM 보정" min={40} max={240} value={bpmInput} placeholder={bpm ? bpm.toFixed(1) : '자동 추정'} disabled={!!busy || recording} onChange={e => setBpmInput(e.target.value)}/></label><label className="field">박자<select value={meter} onChange={e => setMeter(e.target.value)}>{['4/4', '3/4', '6/8', '2/4'].map(m => <option key={m}>{m}</option>)}</select></label><button className="button primary" disabled={!audio || !!busy || recording} onClick={analyze}><Music2 size={16}/>{sections.length ? '송폼 다시 분석' : '송폼 분석하기'}</button><small>박자·BPM·마디 수는 추정값입니다. 라이브의 템포 변화는 직접 교정해 주세요.</small></div>}
      {step === 1 && <section><div className="audio-section-title"><div><h3>송폼 초안</h3><p>A=Verse · B=Chorus · C=Bridge로 시작합니다. 우리 팀의 표기로 바꿔 주세요.</p></div>{bpm > 0 && <span className="pill">♩ ≈ {(Number(bpmInput) || bpm).toFixed(1)}</span>}</div>
        {!sections.length ? <div className="audio-empty">음원을 연결하고 ‘송폼 분석하기’를 눌러 주세요.</div> : <><div className="audio-timeline">{sections.map(s => <button key={s.id} style={{ flexGrow: Math.max(.1, s.end - s.start) }} title={`${s.label} ${timeLabel(s.start)}–${timeLabel(s.end)}`} onClick={() => listen(s.start, s.end)}>{s.label}</button>)}</div><div className="audio-section-list">{sections.map((s, i) => <div className="audio-section-row" key={s.id}><button className="icon-button" aria-label={`${i + 1}번 구간 듣기`} disabled={!audio} onClick={() => listen(s.start, s.end)}><Play size={14}/></button><span className="audio-time">{timeLabel(s.start)}</span><input aria-label={`${i + 1}번 구간 이름`} list="audio-labels" value={s.label} maxLength={40} onChange={e => setSections(current => current.map(x => x.id === s.id ? { ...x, label: e.target.value } : x))}/><label className="audio-end">끝 <input aria-label={`${i + 1}번 구간 끝 초`} type="number" min={s.start + .25} step="0.1" value={Number(s.end.toFixed(2))} disabled={i === sections.length - 1} onChange={e => boundary(i, Number(e.target.value))}/>초</label><button className="icon-button" aria-label={`${i + 1}번 구간 나누기`} onClick={() => split(i)}><Scissors size={15}/></button><button className="icon-button" aria-label={`${i + 1}번 구간 합치기`} disabled={sections.length < 2} onClick={() => remove(i)}><Trash2 size={15}/></button><button className="text-button" onClick={() => { setClipStart(s.start); setClipEnd(Math.min(s.end, s.start + 60)); setDraft(null); setStep(2); }}>간주로 선택</button></div>)}</div><datalist id="audio-labels">{labels.map(l => <option key={l}>{l}</option>)}</datalist><div className="audio-form-preview">{forms.map((f, i) => <span key={i}>{f.label}</span>)}</div><button className="button primary" onClick={applyForm}><Check size={16}/>현재 송폼을 이 내용으로 교체</button></>}
      </section>}
      {step === 2 && <section><div className="audio-section-title"><div><h3>악보 초안 만들기</h3><p>기존 악보에 없는 구간을 선택하거나 전체 곡을 채보합니다. 멜로디 한 줄과 코드 후보를 만들며, 밴드 음원은 교정이 필요합니다.</p></div></div><div className="audio-clip-controls"><fieldset disabled={!!busy || recording} className="audio-clip-fields"><label className="field">시작(초)<input type="number" aria-label="간주 시작 초" min="0" step="0.1" value={clipStart} onChange={e => { setClipStart(e.target.value); setDraft(null); }}/></label><label className="field">끝(초)<input type="number" aria-label="간주 끝 초" step="0.1" min="1" value={clipEnd} onChange={e => { setClipEnd(e.target.value); setDraft(null); }}/></label><label className="field">BPM<input aria-label="간주 BPM" type="number" min={40} max={240} value={bpmInput || (bpm ? bpm.toFixed(1) : 120)} onChange={e => { setBpmInput(e.target.value); setDraft(null); }}/></label><label className="field">박자<select value={meter} onChange={e => { setMeter(e.target.value); setDraft(null); }}>{['4/4', '3/4', '6/8', '2/4'].map(m => <option key={m}>{m}</option>)}</select></label><button className="button" disabled={!audio || !!busy} onClick={() => listen(Number(clipStart), Number(clipEnd))}><Play size={15}/>구간 듣기</button><button className="button primary" disabled={!audio || !!busy || recording} onClick={transcribe}>선택 구간 채보</button><button className="button" disabled={!audio || !!busy || recording} onClick={transcribeWhole}>전체 곡 채보</button></fieldset></div><p className="field-note">전체 곡은 최대 16마디씩 나누어 처리합니다. 곡 길이와 기기 성능에 따라 수분 이상 걸릴 수 있습니다. 분석 중에는 중단할 수 있습니다.</p>{!audio && <div className="audio-empty">음원을 먼저 연결해 주세요. 저장된 송폼은 그대로 수정할 수 있습니다.</div>}
        {draft && <div className="audio-draft">{wholeDrafts.length > 0 && <div className="audio-whole-navigation"><label className="field">수정할 악보 구간<select aria-label="수정할 전체 채보 구간" value={draftIndex} onChange={e => { const index = Number(e.target.value); setDraftIndex(index); setDraft(wholeDrafts[index]); }}>{wholeDrafts.map((d, i) => <option key={i} value={i}>{d.title}</option>)}</select></label><button className="button primary" disabled={!!notationError || !!busy} onClick={addAllDrafts}>전체 {wholeDrafts.length}개 악보를 콘티에 추가</button></div>}<div className="audio-draft-header"><span className="pill">자동 채보 · 수정 전 초안</span><strong>{draft.title}</strong></div><Notation block={draft} onError={setNotationError}/>{notationError && <p className="audio-message error">{notationError}</p>}<div className="audio-draft-fields"><label className="field">악보 제목<input maxLength={100} value={draft.title} onChange={e => patchDraft({ title: e.target.value })}/></label><label className="field">Key<input maxLength={5} value={draft.key} onChange={e => patchDraft({ key: e.target.value })}/></label></div><label className="field">마디별 코드 수정<textarea aria-label="분석한 간주 코드 수정" value={draft.chords} rows="2" maxLength={1500} onChange={e => patchDraft({ chords: e.target.value })}/></label><label className="field">음표 수정 · ABC 표기<textarea aria-label="분석한 간주 음표 수정" value={draft.notes} rows="4" maxLength={10000} onChange={e => patchDraft({ notes: e.target.value })}/></label><p className="field-note">C D E F G A B = 도 레 미 파 솔 라 시 · z = 쉼표 · 숫자 2 = 4분음표 · ^ = ♯ · = = 제자리표 · | = 마디. 코드와 음표의 마디 수를 같게 맞추세요.</p><label className="field">연주 메모<input maxLength={400} value={draft.note} onChange={e => patchDraft({ note: e.target.value })}/></label><button className="button primary" disabled={!!notationError || !!busy} onClick={() => { if (onApplyScore(draft, url) !== false) setNotice('수정한 악보를 찬양 맨 아래에 추가했습니다. 악보·메모에서 위치를 옮길 수 있습니다.'); }}><Plus size={16}/>이 간주 악보를 콘티에 추가</button></div>}
      </section>}
      <details className="audio-credits"><summary>분석 도구와 처리 안내</summary><p>송폼: LinkSeg (M. Buisson, B. McFee, S. Essid, ISMIR 2024), 모델 CC BY 4.0 · LinkSeg-web 코드 MIT. 간주 채보: Spotify Basic Pitch, Apache 2.0. 최초 송폼 분석 시 공개 모델을 내려받습니다. 음원 분석은 현재 기기에서 실행하며 별도 API 키가 필요하지 않습니다.</p><p>결과는 정답이 아닌 편집 가능한 초안입니다. ‘기능 체험’의 합성 음원은 입력한 유튜브 영상의 분석 결과가 아닙니다.</p><a href="https://github.com/elicwhite/LinkSeg-web" target="_blank" rel="noreferrer">LinkSeg-web</a> · <a href="https://github.com/spotify/basic-pitch-ts" target="_blank" rel="noreferrer">Basic Pitch</a></details>
    </div><footer className="modal-footer"><span className="audio-footer-note">송폼·악보는 적용 버튼을 눌러 저장하세요.</span><button className="button" disabled={!!busy || recording} onClick={onClose}>편집기로 돌아가기</button></footer>
  </section></div>;
}
