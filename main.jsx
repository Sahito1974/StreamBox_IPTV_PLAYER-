import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import Hls from 'hls.js';
import { Tv, Search, Heart, Link2, KeyRound, Upload, Play, CircleStop, Settings2, ListVideo, Film, Clapperboard, RefreshCw, Trash2, Menu, X, CalendarDays, Gauge, FileText } from 'lucide-react';
import './styles.css';

const STORAGE_KEY = 'streambox-playlists-v2';
const EPG_KEY = 'streambox-epg-v1';
const safeUrl = value => { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) ? u.href : null; } catch { return null; } };

function parseM3U(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const result = []; let meta = null;
  for (const raw of lines) {
    const line = raw.trim(); if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      const comma = line.indexOf(','); const attrs = comma >= 0 ? line.slice(0, comma) : line;
      const name = comma >= 0 ? line.slice(comma + 1).trim() : 'Unnamed channel';
      meta = { name: name || 'Unnamed channel', group: attrs.match(/group-title=["']([^"']*)["']/i)?.[1] || 'Other', logo: attrs.match(/tvg-logo=["']([^"']*)["']/i)?.[1] || '', tvgId: attrs.match(/tvg-id=["']([^"']*)["']/i)?.[1] || '' };
      continue;
    }
    if (line.startsWith('#')) continue;
    const url = safeUrl(line); if (meta && url) result.push({ ...meta, url, id: `m3u-${result.length}`, type: 'live' });
    meta = null;
  }
  return result;
}
function parseXmltv(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('This XMLTV file is not valid XML.');
  const programmes = [...doc.querySelectorAll('programme')].map((p, i) => {
    const start = parseXmltvDate(p.getAttribute('start')); const stop = parseXmltvDate(p.getAttribute('stop'));
    if (!start || !stop) return null;
    return { id: `epg-${i}`, channelId: p.getAttribute('channel') || '', start: start.toISOString(), stop: stop.toISOString(), title: p.querySelector('title')?.textContent?.trim() || 'Untitled programme', desc: p.querySelector('desc')?.textContent?.trim() || '', category: p.querySelector('category')?.textContent?.trim() || '' };
  }).filter(Boolean);
  if (!programmes.length) throw new Error('No usable programmes found in this XMLTV file.');
  return programmes;
}
function parseXmltvDate(raw) {
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, sec = '00', tz = '+0000'] = m;
  const sign = tz[0] === '-' ? -1 : 1; const offset = sign * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5)));
  return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec) - offset * 60000);
}
function loadSaved() { try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; } }
function loadEpg() { try { return JSON.parse(localStorage.getItem(EPG_KEY) || '[]'); } catch { return []; } }
function normalize(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }
function fmtTime(value) { return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value)); }

function App() {
  const videoRef = useRef(null); const hlsRef = useRef(null); const fileRef = useRef(null); const epgFileRef = useRef(null);
  const [sources, setSources] = useState(loadSaved);
  const [sourceId, setSourceId] = useState(() => loadSaved()[0]?.id || '');
  const [activeTab, setActiveTab] = useState('live'); const [mode, setMode] = useState('m3u');
  const [m3uUrl, setM3uUrl] = useState(''); const [server, setServer] = useState(''); const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  const [sourceName, setSourceName] = useState(''); const [items, setItems] = useState([]); const [categories, setCategories] = useState([]);
  const [categoryId, setCategoryId] = useState('all'); const [query, setQuery] = useState(''); const [favorites, setFavorites] = useState(() => new Set());
  const [current, setCurrent] = useState(null); const [notice, setNotice] = useState('Add an authorized M3U playlist or Xtream Codes account to begin.');
  const [busy, setBusy] = useState(false); const [sidebarOpen, setSidebarOpen] = useState(false); const [streamFormat, setStreamFormat] = useState('m3u8');
  const [hlsLevels, setHlsLevels] = useState([]); const [quality, setQuality] = useState('auto');
  const [epg, setEpg] = useState(loadEpg); const [epgUrl, setEpgUrl] = useState(''); const [epgNotice, setEpgNotice] = useState('Import an XMLTV file or URL to populate the guide.');
  const [guideDay, setGuideDay] = useState('today'); const [episodeList, setEpisodeList] = useState([]); const [episodeParent, setEpisodeParent] = useState(null);

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(sources)); }, [sources]);
  useEffect(() => { localStorage.setItem(EPG_KEY, JSON.stringify(epg)); }, [epg]);
  useEffect(() => () => { if (hlsRef.current) hlsRef.current.destroy(); }, []);
  const activeSource = sources.find(s => s.id === sourceId) || null;

  function stopPlayback() {
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    const v = videoRef.current; if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
    setCurrent(null); setHlsLevels([]); setQuality('auto');
  }
  function startPlayback(item) {
    const url = safeUrl(item.url); if (!url) { setNotice('This stream URL is invalid.'); return; }
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    setCurrent(item); setEpisodeList([]); setEpisodeParent(null); setNotice(`Loading ${item.name}…`); setHlsLevels([]); setQuality('auto');
    const video = videoRef.current; if (!video) return;
    video.pause(); video.removeAttribute('src'); video.load();
    video.onerror = () => setNotice('Playback failed. Verify the stream, provider permissions, network access, and format.');
    if (/\.m3u8(?:$|\?)/i.test(url) && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, capLevelToPlayerSize: false, startLevel: -1 }); hlsRef.current = hls;
      hls.loadSource(url); hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const levels = hls.levels.map((l, i) => ({ index: i, height: l.height || 0, width: l.width || 0, bitrate: l.bitrate || 0 }));
        setHlsLevels(levels); setNotice(levels.length ? `HLS ready · ${levels.length} quality level(s) detected. Highest available: ${Math.max(...levels.map(l => l.height), 0) || 'unknown'}p.` : 'HLS ready.');
        video.play().catch(() => setNotice('Press Play in the player to start playback.'));
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => { const l = hls.levels[data.level]; if (l) setNotice(`Playing · ${l.height || 'Auto'}p HLS`); });
      hls.on(Hls.Events.ERROR, (_, data) => { if (data.fatal) setNotice('HLS playback error. Check stream authorization, provider availability, network, and CORS.'); });
    } else {
      video.src = url; video.load(); video.play().catch(() => setNotice('Press Play in the player to start playback. Native playback quality selection may not be available on this device.'));
    }
  }
  function changeQuality(value) {
    setQuality(value);
    if (hlsRef.current) hlsRef.current.currentLevel = value === 'auto' ? -1 : Number(value);
  }
  async function addSource(source) {
    setSources(prev => prev.some(s => s.id === source.id) ? prev.map(s => s.id === source.id ? source : s) : [...prev, source]);
    setSourceId(source.id); setItems(source.items || []); setCategories(source.categories || []); setCategoryId('all'); setCurrent(null); setNotice(`${source.name} added: ${source.items?.length || 0} catalogue items loaded.`);
  }
  async function importM3UText(text, name = 'My M3U Playlist') {
    const parsed = parseM3U(text); if (!parsed.length) throw new Error('No valid HTTP/HTTPS entries found. Check the M3U format.');
    const groups = [...new Set(parsed.map(x => x.group))].map((title, i) => ({ category_id: String(i), category_name: title, type: 'live' }));
    const id = `m3u-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await addSource({ id, name, kind: 'm3u', items: parsed, categories: groups });
  }
  async function handleM3UUrl() {
    const url = safeUrl(m3uUrl); if (!url) { setNotice('Enter a valid HTTP or HTTPS playlist URL.'); return; }
    setBusy(true); try { const response = await fetch(url); if (!response.ok) throw new Error(`Request failed (${response.status}).`); await importM3UText(await response.text(), sourceName || 'M3U Playlist'); }
    catch (e) { setNotice(`Could not fetch playlist: ${e.message || 'network error'}. Browser CORS may block this URL; upload a local M3U file or use a secure backend you control.`); } finally { setBusy(false); }
  }
  async function handleFile(e) { const file = e.target.files?.[0]; if (!file) return; try { await importM3UText(await file.text(), file.name); } catch (err) { setNotice(err.message || 'Could not read playlist.'); } e.target.value = ''; }

  async function xtreamLogin(e) {
    e.preventDefault(); const base = safeUrl(server);
    if (!base || !username.trim() || !password) { setNotice('Enter a valid server URL, username, and password.'); return; }
    setBusy(true);
    try {
      const cleanBase = base.replace(/\/+$/, ''); const api = new URL(`${cleanBase}/player_api.php`); api.searchParams.set('username', username.trim()); api.searchParams.set('password', password);
      const get = async action => { const u = new URL(api.href); if (action) u.searchParams.set('action', action); const r = await fetch(u.href); if (!r.ok) throw new Error(`Provider request failed (${r.status}).`); return r.json(); };
      const auth = await get(''); if (!auth?.user_info || String(auth.user_info.auth) !== '1') throw new Error('Provider did not authenticate these credentials.');
      const [liveCats, live, vodCats, vod, seriesCats, series] = await Promise.all([get('get_live_categories'), get('get_live_streams'), get('get_vod_categories'), get('get_vod_streams'), get('get_series_categories'), get('get_series')]);
      const mapped = []; const catGroups = [];
      const mapCategory = (arr, type) => (Array.isArray(arr) ? arr : []).forEach(c => catGroups.push({ category_id: String(c.category_id ?? ''), category_name: c.category_name || 'Other', type }));
      mapCategory(liveCats, 'live'); mapCategory(vodCats, 'movie'); mapCategory(seriesCats, 'series');
      (Array.isArray(live) ? live : []).forEach(x => mapped.push({ id: `live-${x.stream_id}`, name: x.name || 'Live channel', logo: x.stream_icon || '', tvgId: x.epg_channel_id || '', group: catGroups.find(c => c.type === 'live' && c.category_id === String(x.category_id))?.category_name || 'Live TV', categoryId: String(x.category_id ?? ''), type: 'live', url: `${cleanBase}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${encodeURIComponent(x.stream_id)}.${streamFormat}` }));
      (Array.isArray(vod) ? vod : []).forEach(x => { const ext = String(x.container_extension || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4'; mapped.push({ id: `movie-${x.stream_id}`, name: x.name || 'Movie', logo: x.stream_icon || '', group: catGroups.find(c => c.type === 'movie' && c.category_id === String(x.category_id))?.category_name || 'Movies', categoryId: String(x.category_id ?? ''), type: 'movie', url: `${cleanBase}/movie/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${encodeURIComponent(x.stream_id)}.${ext}` }); });
      (Array.isArray(series) ? series : []).forEach(x => mapped.push({ id: `series-${x.series_id}`, name: x.name || 'Series', logo: x.cover || '', group: catGroups.find(c => c.type === 'series' && c.category_id === String(x.category_id))?.category_name || 'Series', categoryId: String(x.category_id ?? ''), type: 'series', seriesId: x.series_id }));
      await addSource({ id: `xtream-${Date.now()}`, name: sourceName || new URL(cleanBase).hostname, kind: 'xtream', base: cleanBase, username: username.trim(), password, items: mapped, categories: catGroups });
      setNotice(`Connected. Loaded ${mapped.length} catalogue items. EPG can be imported separately from an XMLTV source.`);
    } catch (err) { setNotice(`Xtream login failed: ${err.message || 'network or provider error'}. Some providers block browser CORS and may require a secure backend.`); } finally { setBusy(false); }
  }
  async function loadSeriesEpisodes(item) {
    if (!activeSource || activeSource.kind !== 'xtream') { setNotice('Episode lookup requires an Xtream Codes source that supports get_series_info.'); return; }
    setBusy(true); setNotice(`Loading episodes for ${item.name}…`);
    try {
      const u = new URL(`${activeSource.base}/player_api.php`); u.searchParams.set('username', activeSource.username); u.searchParams.set('password', activeSource.password); u.searchParams.set('action', 'get_series_info'); u.searchParams.set('series_id', String(item.seriesId));
      const r = await fetch(u.href); if (!r.ok) throw new Error(`Provider request failed (${r.status}).`); const data = await r.json(); const episodes = [];
      Object.entries(data.episodes || {}).forEach(([season, list]) => (Array.isArray(list) ? list : []).forEach(ep => { const ext = String(ep.container_extension || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4'; episodes.push({ id: `episode-${ep.id}`, name: ep.title || ep.info?.name || `Episode ${ep.episode_num || ''}`, group: `Season ${season}`, type: 'episode', url: `${activeSource.base}/series/${encodeURIComponent(activeSource.username)}/${encodeURIComponent(activeSource.password)}/${encodeURIComponent(ep.id)}.${ext}`, episodeNum: ep.episode_num, season }); }));
      if (!episodes.length) throw new Error('No episode records were returned by the provider.'); setEpisodeParent(item); setEpisodeList(episodes); setNotice(`${episodes.length} episodes available for ${item.name}.`);
    } catch (err) { setNotice(`Could not load episodes: ${err.message || 'provider error'}.`); } finally { setBusy(false); }
  }
  async function importEpgText(text, label = 'XMLTV guide') {
    const parsed = parseXmltv(text); setEpg(parsed); setEpgNotice(`${parsed.length} programme listings loaded from ${label}.`); setActiveTab('guide');
  }
  async function handleEpgFile(e) { const f = e.target.files?.[0]; if (!f) return; try { await importEpgText(await f.text(), f.name); } catch (err) { setEpgNotice(err.message || 'Could not import XMLTV.'); } e.target.value = ''; }
  async function handleEpgUrl() { const url = safeUrl(epgUrl); if (!url) { setEpgNotice('Enter a valid HTTP/HTTPS XMLTV URL.'); return; } setBusy(true); try { const r = await fetch(url); if (!r.ok) throw new Error(`Request failed (${r.status}).`); await importEpgText(await r.text(), 'remote XMLTV'); } catch (err) { setEpgNotice(`Could not fetch guide: ${err.message || 'network error'}. Browser CORS may block the URL; upload an XMLTV file instead.`); } finally { setBusy(false); } }
  async function selectSource(id) { const s = sources.find(x => x.id === id); if (!s) return; stopPlayback(); setSourceId(id); setItems(s.items || []); setCategories(s.categories || []); setCategoryId('all'); setActiveTab('live'); setNotice(`${s.name} selected.`); }
  const visibleItems = useMemo(() => items.filter(item => {
    const typeMatches = activeTab === 'favorites' ? favorites.has(item.id) : activeTab === 'live' ? item.type === 'live' : activeTab === 'movies' ? item.type === 'movie' : activeTab === 'series' ? item.type === 'series' : false;
    const cat = categories.find(c => String(c.category_id) === categoryId);
    const categoryMatches = categoryId === 'all' || !cat || (cat.type === item.type && String(item.categoryId ?? '') === String(cat.category_id)) || (activeSource?.kind === 'm3u' && item.group === cat.category_name);
    return typeMatches && categoryMatches && item.name.toLowerCase().includes(query.toLowerCase());
  }), [items, activeTab, favorites, categoryId, categories, query, activeSource]);
  const guideChannels = useMemo(() => items.filter(i => i.type === 'live').filter(ch => epg.some(p => p.channelId === ch.tvgId || p.channelId === ch.id || normalize(p.channelId) === normalize(ch.name))), [items, epg]);
  const now = Date.now();
  const programmesFor = channel => epg.filter(p => (p.channelId === channel.tvgId || p.channelId === channel.id || normalize(p.channelId) === normalize(channel.name)) && (guideDay === 'today' ? new Date(p.stop).getTime() > now && new Date(p.start).getTime() < now + 86400000 : new Date(p.start).getTime() >= now + 86400000 && new Date(p.start).getTime() < now + 172800000)).sort((a,b) => new Date(a.start)-new Date(b.start)).slice(0,8);
  function deleteSource(id) { const next = sources.filter(s => s.id !== id); setSources(next); if (sourceId === id) { stopPlayback(); const s = next[0]; setSourceId(s?.id || ''); setItems(s?.items || []); setCategories(s?.categories || []); } setNotice('Playlist removed from this device.'); }

  return <div className="app-shell">
    <header className="topbar"><button className="icon-btn mobile-only" onClick={() => setSidebarOpen(!sidebarOpen)} aria-label="Toggle menu">{sidebarOpen ? <X/> : <Menu/>}</button><div className="brand-mark"><Tv size={23}/></div><div className="brand"><strong>STREAM<span>BOX</span></strong><small>IPTV PLAYER</small></div><div className="top-spacer"/><div className="connection"><span className={activeSource ? 'dot on' : 'dot'}/>{activeSource ? activeSource.name : 'No source connected'}</div></header>
    <div className="layout"><aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}><div className="side-heading">YOUR PLAYLISTS <button className="icon-btn small" onClick={() => setMode(mode === 'm3u' ? 'xtream' : 'm3u')} title="Add playlist"><Link2 size={16}/></button></div>
      {sources.map(s => <div className={`source-row ${s.id === sourceId ? 'selected' : ''}`} key={s.id}><button className="source-select" onClick={() => {selectSource(s.id);setSidebarOpen(false);}}><span className="source-icon">{s.kind === 'xtream' ? <KeyRound size={17}/> : <ListVideo size={17}/>}</span><span className="source-text"><b>{s.name}</b><small>{s.kind.toUpperCase()} · {s.items?.length || 0} items</small></span></button><button className="icon-btn small delete-btn" title="Remove playlist" onClick={() => deleteSource(s.id)}><Trash2 size={14}/></button></div>)}
      <button className="add-source" onClick={() => {setMode('m3u');document.getElementById('add-source')?.scrollIntoView({behavior:'smooth'});setSidebarOpen(false);}}><span>＋</span> Add playlist</button><div className="side-note"><Settings2 size={15}/> Starter app: provider credentials are saved locally. Use a secure backend before public release.</div></aside>
      <main className="main-content"><section className="hero"><div><div className="eyebrow">YOUR ENTERTAINMENT HUB</div><h1>Everything you watch.<br/><span>One player.</span></h1><p>Bring your authorized streams and playlists together.</p></div><div className="hero-icon"><Tv size={45}/><span>LIVE</span></div></section>
      <section className="player-panel"><div className="player-screen"><video ref={videoRef} controls playsInline/>{!current && <div className="player-empty"><div className="play-emblem"><Play size={28} fill="currentColor"/></div><b>Ready when you are</b><p>Select a channel or add a playlist to start.</p></div>}</div>
        <div className="player-info"><div><b>{current?.name || 'No media selected'}</b><small>{current ? `${current.group} · ${current.type.toUpperCase()}` : 'PLAYER STANDBY'}</small></div><div className="player-controls">{hlsLevels.length > 0 && <label className="quality-control"><Gauge size={14}/><select aria-label="HLS quality" value={quality} onChange={e=>changeQuality(e.target.value)}><option value="auto">Auto quality</option>{hlsLevels.map(l=><option key={l.index} value={String(l.index)}>{l.height ? `${l.height}p` : `${Math.round(l.bitrate/1000)} kbps`}{l.width >= 3840 ? ' · 4K' : ''}</option>)}</select></label>}<button className="outline-btn" onClick={stopPlayback}><CircleStop size={16}/> Stop</button></div></div>
        <div className="notice" role="status">{busy && <RefreshCw className="spin" size={14}/>} {notice}</div>
        {episodeList.length > 0 && <div className="episodes-panel"><div className="episodes-head"><b>Episodes · {episodeParent?.name}</b><button className="outline-btn" onClick={()=>{setEpisodeList([]);setEpisodeParent(null)}}>Close</button></div><div className="episode-list">{episodeList.map(ep=><button key={ep.id} className="episode-row" onClick={()=>startPlayback(ep)}><Play size={14}/><span><b>{ep.name}</b><small>{ep.group}</small></span></button>)}</div></div>}
      </section>
      <section id="add-source" className="add-panel"><div className="section-title"><div><h2>Add a playlist</h2><p>Use a playlist file, URL, or provider login.</p></div></div><div className="mode-switch"><button className={mode === 'm3u' ? 'active' : ''} onClick={() => setMode('m3u')}><Link2 size={16}/> M3U / M3U8</button><button className={mode === 'xtream' ? 'active' : ''} onClick={() => setMode('xtream')}><KeyRound size={16}/> Xtream Codes</button></div>
        {mode === 'm3u' ? <div className="form-grid"><label>Playlist name <input value={sourceName} onChange={e=>setSourceName(e.target.value)} placeholder="e.g. Home TV"/></label><label className="wide">M3U playlist URL <input value={m3uUrl} onChange={e=>setM3uUrl(e.target.value)} placeholder="https://provider.example/playlist.m3u"/></label><div className="form-actions"><button className="primary-btn" disabled={busy} onClick={handleM3UUrl}><Link2 size={16}/> Load URL</button><button className="outline-btn" onClick={()=>fileRef.current?.click()}><Upload size={16}/> Upload file</button><input ref={fileRef} type="file" accept=".m3u,.m3u8,.txt" hidden onChange={handleFile}/></div></div> : <form className="form-grid" onSubmit={xtreamLogin}><label>Playlist name <input value={sourceName} onChange={e=>setSourceName(e.target.value)} placeholder="Optional display name"/></label><label className="wide">Server URL <input value={server} onChange={e=>setServer(e.target.value)} placeholder="https://provider.example:8080" required/></label><label>Username <input value={username} onChange={e=>setUsername(e.target.value)} autoComplete="username" required/></label><label>Password <input value={password} onChange={e=>setPassword(e.target.value)} type="password" autoComplete="current-password" required/></label><label>Live stream format <select value={streamFormat} onChange={e=>setStreamFormat(e.target.value)}><option value="m3u8">HLS (.m3u8)</option><option value="ts">MPEG-TS (.ts)</option></select></label><div className="form-actions"><button className="primary-btn" disabled={busy} type="submit"><KeyRound size={16}/> {busy ? 'Connecting…' : 'Connect provider'}</button></div><p className="form-footnote wide">Development build only: Xtream credentials are stored in local browser storage. Move credential handling to a secure backend before public release.</p></form>}
      </section>
      <section className="add-panel epg-panel"><div className="section-title"><div><h2><CalendarDays size={18}/> TV guide (XMLTV / EPG)</h2><p>Import a provider-supplied XMLTV file to see programme times.</p></div></div><div className="form-grid"><label className="wide">XMLTV URL <input value={epgUrl} onChange={e=>setEpgUrl(e.target.value)} placeholder="https://provider.example/guide.xml"/></label><div className="form-actions"><button className="primary-btn" disabled={busy} onClick={handleEpgUrl}><Link2 size={16}/> Load guide URL</button><button className="outline-btn" onClick={()=>epgFileRef.current?.click()}><FileText size={16}/> Upload XMLTV</button><input ref={epgFileRef} type="file" accept=".xml,.xmltv,.txt,application/xml,text/xml" hidden onChange={handleEpgFile}/></div><div className="form-footnote wide" role="status">{epgNotice} Programme/channel matching uses the XMLTV channel ID and playlist tvg-id where available.</div></div></section>
      <section className="library"><div className="section-title"><div><h2>Your library</h2><p>{items.length} items in the selected source</p></div><div className="search-box"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search your library"/></div></div>
        <div className="library-tabs"><button className={activeTab==='live'?'active':''} onClick={()=>{setActiveTab('live');setCategoryId('all')}}><Tv size={16}/> Live TV</button><button className={activeTab==='movies'?'active':''} onClick={()=>{setActiveTab('movies');setCategoryId('all')}}><Film size={16}/> Movies</button><button className={activeTab==='series'?'active':''} onClick={()=>{setActiveTab('series');setCategoryId('all')}}><Clapperboard size={16}/> Series</button><button className={activeTab==='favorites'?'active':''} onClick={()=>{setActiveTab('favorites');setCategoryId('all')}}><Heart size={16}/> Favorites</button><button className={activeTab==='guide'?'active':''} onClick={()=>setActiveTab('guide')}><CalendarDays size={16}/> Guide</button></div>
        {activeTab === 'guide' ? <div className="guide-content"><div className="guide-toolbar"><b>Programme schedule</b><select value={guideDay} onChange={e=>setGuideDay(e.target.value)}><option value="today">Now and next 24 hours</option><option value="tomorrow">Next day</option></select></div>{!epg.length ? <div className="empty-library"><div><CalendarDays size={28}/></div><b>No guide data yet</b><p>Import an XMLTV guide above. The guide only displays schedules present in your provider's data.</p></div> : !guideChannels.length ? <div className="empty-library"><div><CalendarDays size={28}/></div><b>Guide imported, channels not matched</b><p>Ensure playlist tvg-id values match the channel IDs in the XMLTV file.</p></div> : <div className="guide-list">{guideChannels.slice(0,100).map(ch=><div className="guide-channel" key={ch.id}><button className="guide-channel-name" onClick={()=>startPlayback(ch)}>{ch.logo ? <img src={ch.logo} alt=""/> : <Tv size={18}/>}<span>{ch.name}</span><Play size={13}/></button><div className="programme-list">{programmesFor(ch).map(p=><div className={`programme ${new Date(p.start).getTime()<=now && new Date(p.stop).getTime()>now?'on-air':''}`} key={p.id}><div>{fmtTime(p.start)} – {fmtTime(p.stop)}{new Date(p.start).getTime()<=now && new Date(p.stop).getTime()>now?' · NOW':''}</div><b>{p.title}</b>{p.desc && <small>{p.desc}</small>}</div>)}{programmesFor(ch).length===0 && <span className="form-footnote">No schedule available for this channel/time.</span>}</div></div>)}</div>}</div> : <><div className="category-row"><select value={categoryId} onChange={e=>setCategoryId(e.target.value)}><option value="all">All categories</option>{categories.filter(c=>activeTab==='live'?c.type==='live':activeTab==='movies'?c.type==='movie':activeTab==='series'?c.type==='series':true).map((c,i)=><option key={`${c.type}-${c.category_id}-${i}`} value={String(c.category_id)}>{c.category_name}</option>)}</select><span>{visibleItems.length} results</span></div>{visibleItems.length ? <div className="media-grid">{visibleItems.slice(0,300).map(item=><article className="media-card" key={item.id}><button className="media-poster" onClick={()=>item.type==='series'?loadSeriesEpisodes(item):startPlayback(item)}><span className="poster-logo">{item.logo ? <img src={item.logo} alt="" onError={e=>e.currentTarget.style.display='none'}/> : item.type==='movie'?<Film/>:item.type==='series'?<Clapperboard/>:<Tv/>}</span><span className="poster-play"><Play size={17} fill="currentColor"/></span><span className="media-type">{item.type}</span></button><div className="media-card-info"><b title={item.name}>{item.name}</b><small>{item.group}</small><button className={`favorite-btn ${favorites.has(item.id)?'fav':''}`} title="Toggle favorite" onClick={()=>setFavorites(prev=>{const n=new Set(prev);n.has(item.id)?n.delete(item.id):n.add(item.id);return n;})}><Heart size={16} fill={favorites.has(item.id)?'currentColor':'none'}/></button></div></article>)}</div> : <div className="empty-library"><div><ListVideo size={28}/></div><b>{items.length ? 'Nothing found here' : 'Your library is waiting'}</b><p>{items.length ? 'Try another category or search term.' : 'Add an M3U playlist or connect your authorized provider above.'}</p></div>}{visibleItems.length > 300 && <p className="form-footnote">Showing the first 300 matching items for performance.</p>}</>}
      </section><footer>STREAMBOX IPTV · Independent player starter · No channels or subscriptions included</footer></main></div></div>;
}
createRoot(document.getElementById('root')).render(<App/>);
