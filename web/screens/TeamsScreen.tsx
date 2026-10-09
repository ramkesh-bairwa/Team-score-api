'use client';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import AsyncStorage from '@/lib/storage';
import {
  listTeams, createTeam, updateTeam, deleteTeam, syncPendingTeams, pendingTeamCount, isServerReachable,
  SharedTeam, SharedPlayer, PlayerRole,
} from '@/lib/services/teams';
import { popup } from '@/components/Popup';
import { C } from '@/lib/theme';
import s from './TeamsScreen.module.css';

const ROLES: { key: PlayerRole; icon: string }[] = [
  { key: 'Batter', icon: '🏏' },
  { key: 'Bowler', icon: '🎳' },
  { key: 'All-Rounder', icon: '⭐' },
  { key: 'Keeper', icon: '🧤' },
  { key: 'Captain', icon: '©' },
];
const NAME_KEY = 'cricscore_scorer_name';

const Spinner = ({ color = C.white, large }: { color?: string; large?: boolean }) => (
  <span className={`${s.spinner} ${large ? s.spinnerLarge : ''}`} style={{ borderColor: color, borderTopColor: 'transparent' }} />
);

// Full-screen slide-up sheet (the app's <Modal animationType="slide">)
function SlideModal({ visible, onRequestClose, children }: { visible: boolean; onRequestClose: () => void; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(visible);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (visible) {
      setMounted(true);
      const t = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(t);
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), 300);
    return () => clearTimeout(t);
  }, [visible]);
  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onRequestClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onKey); };
  }, [mounted, onRequestClose]);
  if (!mounted || typeof document === 'undefined') return null;
  return createPortal(
    <div className={`${s.sheet} ${shown ? s.sheetShown : ''}`} role="dialog" aria-modal="true">{children}</div>,
    document.body,
  );
}

// Create and browse teams shared with every app user
export default function TeamsScreen({ navigation }: any) {
  const [teams, setTeams] = useState<SharedTeam[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // Offline / sync state
  const [offline, setOffline] = useState(false);
  const [pending, setPending] = useState(0);
  const [online, setOnline] = useState(false);
  const [syncing, setSyncing] = useState(false);

  // Editor
  const [editor, setEditor] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [teamName, setTeamName] = useState('');
  const [creator, setCreator] = useState('');
  const [players, setPlayers] = useState<SharedPlayer[]>([]);
  const [pName, setPName] = useState('');
  const [pMobile, setPMobile] = useState('');
  const [pRoles, setPRoles] = useState<PlayerRole[]>(['Batter']);
  const [saving, setSaving] = useState(false);

  const reqId = React.useRef(0);
  const searchRef = React.useRef(search);
  searchRef.current = search;
  const load = (q = searchRef.current) => {
    const id = ++reqId.current; // ignore out-of-order responses while typing
    setLoading(true);
    setError(null);
    pendingTeamCount().then(setPending);
    listTeams(q)
      .then(r => {
        if (id !== reqId.current) return;
        setTeams(r.teams);
        setOffline(r.offline);
        setOnline(!r.offline);
      })
      .catch(e => { if (id === reqId.current) setError(e.message); })
      .finally(() => { if (id === reqId.current) setLoading(false); });
  };

  // Load on open, and again when the tab becomes visible (the app reloads on focus)
  useEffect(() => {
    load();
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // While changes are waiting, keep checking whether the server is reachable to offer Sync
  useEffect(() => {
    if (!pending) return;
    let alive = true;
    const check = () => isServerReachable().then(ok => { if (alive) setOnline(ok); });
    check();
    const t = setInterval(check, 10000);
    return () => { alive = false; clearInterval(t); };
  }, [pending]);

  const sync = async () => {
    setSyncing(true);
    try {
      const r = await syncPendingTeams();
      const failedText = r.failed.map(f => `• ${f.name}: ${f.error}`).join('\n');
      if (r.offline) {
        popup.alert('Sync Paused', `Synced ${r.synced}. Connection dropped; the rest will sync later.${failedText ? `\n\n${failedText}` : ''}`, undefined, 'warning');
      } else if (r.failed.length) {
        popup.alert('Synced With Problems', `Synced ${r.synced}. These were not accepted by the server:\n\n${failedText}`, undefined, 'warning');
      } else {
        popup.alert('All Synced', `${r.synced} team change${r.synced === 1 ? '' : 's'} uploaded. Everyone can see them now.`, undefined, 'success');
      }
    } finally {
      setSyncing(false);
      load();
    }
  };

  const openEditor = async (team?: SharedTeam) => {
    setEditingId(team?.id ?? null);
    setTeamName(team?.name ?? '');
    setPlayers(team ? team.players.map(p => ({ ...p, roles: [...p.roles] })) : []);
    setCreator((await AsyncStorage.getItem(NAME_KEY).catch(() => null)) || '');
    setPName('');
    setPMobile('');
    setPRoles(['Batter']);
    setEditor(true);
  };

  const closeEditor = React.useCallback(() => setEditor(false), []);

  const toggleRole = (r: PlayerRole) =>
    setPRoles(prev => (prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]));

  const addPlayer = () => {
    const name = pName.trim();
    const mobile = pMobile.replace(/[\s-]/g, '');
    if (!name) { popup.alert('Name Required', 'Enter the player name.', undefined, 'warning'); return; }
    if (players.some(p => p.name.toLowerCase() === name.toLowerCase())) {
      popup.alert('Duplicate Player', `${name} is already in this team.`, undefined, 'warning'); return;
    }
    if (players.length >= 11) { popup.alert('Team Full', 'A team can have at most 11 players.', undefined, 'warning'); return; }
    if (mobile && !/^\+?\d{10,13}$/.test(mobile)) {
      popup.alert('Invalid Mobile No.', 'Enter a valid 10-digit mobile number.', undefined, 'warning'); return;
    }
    let list = players;
    // Only one captain per team
    if (pRoles.includes('Captain')) list = list.map(p => ({ ...p, roles: p.roles.filter(r => r !== 'Captain') }));
    setPlayers([...list, { name, mobile: mobile || undefined, roles: pRoles.length ? pRoles : ['Batter'] }]);
    setPName('');
    setPMobile('');
    setPRoles(['Batter']);
  };

  const makeCaptain = (name: string) =>
    setPlayers(list => list.map(p => ({
      ...p,
      roles: p.name === name
        ? (p.roles.includes('Captain') ? p.roles : [...p.roles, 'Captain'])
        : p.roles.filter(r => r !== 'Captain'),
    })));

  const save = async () => {
    const name = teamName.trim();
    if (!name) { popup.alert('Team Name Required', 'Enter a team name.', undefined, 'warning'); return; }
    if (players.length < 2) { popup.alert('More Players Needed', 'Add at least 2 players.', undefined, 'warning'); return; }
    setSaving(true);
    try {
      if (creator.trim()) AsyncStorage.setItem(NAME_KEY, creator.trim()).catch(() => {});
      const result = editingId
        ? await updateTeam(editingId, name, players)
        : await createTeam(name, players, creator.trim() || 'Unknown');
      const savedLocally = !result || result.pending;
      setEditor(false);
      if (savedLocally) {
        popup.alert('Saved on This Phone', `No internet right now. ${name} is saved here and will be visible to everyone after you sync.`, undefined, 'warning');
      } else {
        popup.alert(editingId ? 'Team Updated' : 'Team Created', `${name} is now available to everyone using CricScore.`, undefined, 'success');
      }
      load();
    } catch (e: any) {
      popup.alert('Could Not Save Team', e.message, undefined, 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = (team: SharedTeam) => {
    popup.alert('Delete Team?', `${team.name} will be removed for everyone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => {
        deleteTeam(team.id, team.name).then(() => load()).catch(e => popup.alert('Could Not Delete', e.message, undefined, 'error'));
      }},
    ]);
  };

  return (
    <div className={s.container}>
      <div className={s.header}>
        <div className={s.headerInner}>
          <button className={s.headerBtn} onClick={() => navigation.goBack()} aria-label="Back">
            <span className={s.back}>←</span>
          </button>
          <div className={s.headerTitle}>Teams</div>
          <button className={s.newBtn} onClick={() => openEditor()}>+ New</button>
        </div>
      </div>

      <div className={s.content}>
        <div className={s.searchWrap}>
          <input
            className={s.search}
            placeholder="🔍  Search team or player"
            value={search}
            onChange={e => { const v = e.target.value; setSearch(v); load(v); }}
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <div className={s.scroll}>
          {pending > 0 && (
            <div className={`${s.syncBar} ${online ? s.syncBarOnline : s.syncBarOffline}`}>
              <span className={s.syncIcon}>{online ? '☁️' : '📴'}</span>
              <span className={`${s.syncText} ${online ? s.syncTextOnline : s.syncTextOffline}`}>
                {online
                  ? `${pending} change${pending === 1 ? '' : 's'} ready to sync`
                  : `Offline · ${pending} change${pending === 1 ? '' : 's'} saved on this phone`}
              </span>
              {online && (
                <button className={s.syncBtn} onClick={sync} disabled={syncing}>
                  {syncing ? <Spinner /> : 'Sync now'}
                </button>
              )}
            </div>
          )}
          {offline && !pending && <div className={s.offlineNote}>📴 Offline · showing teams saved on this phone</div>}
          {error ? (
            <div className={s.center}>
              <div className={s.error}>⛔ {error}</div>
              <button className={s.retry} onClick={() => load()}>Retry</button>
            </div>
          ) : loading && !teams.length ? (
            <div className={s.center}><Spinner color={C.primary} /></div>
          ) : teams.length === 0 ? (
            <div className={s.center}>
              <div className={s.emptyIcon}>👥</div>
              <div className={s.emptyTitle}>{search ? 'No teams found' : 'No teams yet'}</div>
              <div className={s.emptySub}>Create a team once and everyone can pick it when starting a match.</div>
            </div>
          ) : (
            <div className={s.grid}>
              {teams.map(team => {
                const open = openId === team.id;
                return (
                  <div key={team.id} className={s.card}>
                    <button className={s.cardHead} onClick={() => setOpenId(open ? null : team.id)}>
                      <div className={s.badge}><span className={s.badgeText}>{team.name.slice(0, 2).toUpperCase()}</span></div>
                      <div className={s.info}>
                        <div className={`${s.teamName} ${s.ellipsis}`}>{team.name}</div>
                        <div className={s.meta}>{team.players.length} players · by {team.createdBy}</div>
                      </div>
                      {team.pending ? <span className={s.notSynced}>NOT SYNCED</span> : team.mine && <span className={s.mine}>YOURS</span>}
                      <span className={s.chev}>{open ? '▴' : '▾'}</span>
                    </button>
                    {open && (
                      <>
                        {team.players.map((p, i) => (
                          <div key={p.name} className={s.playerRow}>
                            <span className={s.playerNum}>{i + 1}</span>
                            <span className={`${s.playerName} ${s.ellipsis}`}>
                              {p.name}{p.roles.includes('Captain') ? ' (c)' : ''}{p.roles.includes('Keeper') ? ' (wk)' : ''}
                            </span>
                            <span className={`${s.playerRoles} ${s.ellipsis}`}>
                              {p.roles.filter(r => r !== 'Captain').map(r => ROLES.find(x => x.key === r)?.icon).join(' ')}
                            </span>
                          </div>
                        ))}
                        <div className={s.actions}>
                          <button className={`${s.actionBtn} ${s.actionPrimary}`} onClick={() => navigation.navigate('SetupTeam', { presetTeam: team })}>
                            🏏 Start Match
                          </button>
                          {(team.mine || team.pending) && (
                            <>
                              <button className={s.actionBtn} onClick={() => openEditor(team)}>Edit</button>
                              <button className={s.actionBtn} style={{ color: C.primary }} onClick={() => remove(team)}>Delete</button>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Create / edit team */}
      <SlideModal visible={editor} onRequestClose={closeEditor}>
        <div className={s.header}>
          <div className={s.headerInner}>
            <button className={s.headerBtn} onClick={closeEditor} aria-label="Close">
              <span className={s.back}>✕</span>
            </button>
            <div className={s.headerTitle}>{editingId ? 'Edit Team' : 'Create Team'}</div>
            <button className={s.newBtn} onClick={save} disabled={saving}>
              {saving ? <Spinner /> : 'Save'}
            </button>
          </div>
        </div>
        <div className={s.sheetBody}>
          <div className={`${s.scroll} ${s.editorCol}`}>
            <div className={s.label}>TEAM NAME</div>
            <input className={s.input} value={teamName} onChange={e => setTeamName(e.target.value)} placeholder="e.g. Mumbai Warriors" />
            {!editingId && (
              <>
                <div className={s.label}>YOUR NAME</div>
                <input className={s.input} value={creator} onChange={e => setCreator(e.target.value)} placeholder="Shown as 'created by'" />
              </>
            )}

            <div className={s.label}>ADD PLAYER ({players.length}/11)</div>
            <form className={s.card} onSubmit={e => { e.preventDefault(); addPlayer(); }}>
              <input className={s.input} value={pName} onChange={e => setPName(e.target.value)} placeholder="Player name" />
              <input className={s.input} value={pMobile} onChange={e => setPMobile(e.target.value)} placeholder="📱 Mobile (optional)" type="tel" inputMode="tel" maxLength={14} />
              <div className={s.roles}>
                {ROLES.map(r => (
                  <button type="button" key={r.key} className={`${s.role} ${pRoles.includes(r.key) ? s.roleOn : ''}`} onClick={() => toggleRole(r.key)}>
                    {r.icon} {r.key}
                  </button>
                ))}
              </div>
              <button type="submit" className={s.addBtn}>+ Add Player</button>
            </form>

            {players.length > 0 && (
              <div className={s.card}>
                {players.map((p, i) => (
                  <div key={p.name} className={s.playerRow}>
                    <span className={s.playerNum}>{i + 1}</span>
                    <div className={s.info}>
                      <div className={`${s.playerName} ${s.ellipsis}`}>{p.name}</div>
                      <div className={`${s.meta} ${s.ellipsis}`}>
                        {p.roles.filter(r => r !== 'Captain').join(', ') || 'Player'}{p.mobile ? ` · ${p.mobile}` : ''}
                      </div>
                    </div>
                    <button
                      className={`${s.capBtn} ${p.roles.includes('Captain') ? s.capBtnOn : ''}`}
                      onClick={() => makeCaptain(p.name)}>
                      C
                    </button>
                    <button className={s.removeBtn} onClick={() => setPlayers(players.filter(x => x.name !== p.name))} aria-label="Remove player">✕</button>
                  </div>
                ))}
                <div className={s.hint}>Tap C to make a player captain</div>
              </div>
            )}
          </div>
        </div>
      </SlideModal>
    </div>
  );
}
