'use client';
import React, { useEffect, useState } from 'react';
import { C } from '@/lib/theme';
import { popup } from '@/components/Popup';
import AsyncStorage from '@/lib/storage';
import TeamPicker, { BottomSheet } from '@/components/TeamPicker';
import { SharedTeam, createTeam } from '@/lib/services/teams';
import { pickImage } from '@/lib/pickImage';
import { SETUP_DRAFT, BET_DRAFT, loadDraft, saveDraft, clearDrafts } from '@/lib/screenDraft';
import s from './SetupTeamScreen.module.css';

type PlayerRole = 'Batter' | 'Bowler' | 'All-Rounder' | 'Captain' | 'Keeper' | 'Impact Player';
type Player = { name: string; nickname: string; mobile?: string; photo?: string; roles: PlayerRole[] };
type Step = 'teams' | 'players' | 'settings';

const ALL_ROLES: { key: PlayerRole; icon: string }[] = [
  { key: 'Batter', icon: '🏏' },
  { key: 'Bowler', icon: '🎳' },
  { key: 'All-Rounder', icon: '⭐' },
  { key: 'Captain', icon: '©' },
  { key: 'Keeper', icon: '🧤' },
  { key: 'Impact Player', icon: '⚡' },
];

const toPlayers = (team: SharedTeam): Player[] =>
  team.players.map(p => ({ name: p.name, nickname: p.nickname || '', mobile: p.mobile, roles: p.roles as PlayerRole[] }));

type Draft = {
  step: Step; team1Name: string; team2Name: string; activeTeam: 1 | 2;
  team1Players: Player[]; team2Players: Player[]; playerInput: string;
  team1Captain: string; team2Captain: string; savedId1?: string; savedId2?: string;
  overs: string; matchType: 'local' | 'domestic'; location: string;
};

export default function SetupTeamScreen({ navigation, route }: any) {
  // Opened from the Teams screen with a saved team pre-selected as "Your Team"
  const preset: SharedTeam | undefined = route?.params?.presetTeam;
  // Restored when coming Back from Bet (the page remounts on the web)
  const [draft] = useState(() => loadDraft<Draft>(SETUP_DRAFT, 'SetupTeam'));
  const [step, setStep] = useState<Step>(draft?.step ?? 'teams');
  const [team1Name, setTeam1Name] = useState(draft?.team1Name ?? preset?.name ?? '');
  const [team2Name, setTeam2Name] = useState(draft?.team2Name ?? '');
  const [activeTeam, setActiveTeam] = useState<1 | 2>(draft?.activeTeam ?? 1);
  const [team1Players, setTeam1Players] = useState<Player[]>(draft?.team1Players ?? (preset ? toPlayers(preset) : []));
  const [team2Players, setTeam2Players] = useState<Player[]>(draft?.team2Players ?? []);
  const [playerInput, setPlayerInput] = useState(draft?.playerInput ?? '');
  const [team1Captain, setTeam1Captain] = useState(draft?.team1Captain ?? preset?.captain ?? '');
  const [team2Captain, setTeam2Captain] = useState(draft?.team2Captain ?? '');
  const [savedId1, setSavedId1] = useState<string | undefined>(draft ? draft.savedId1 : preset?.id);
  const [savedId2, setSavedId2] = useState<string | undefined>(draft?.savedId2);
  const [pickerFor, setPickerFor] = useState<1 | 2 | null>(null);
  const [savingTeam, setSavingTeam] = useState(false);
  const [overs, setOvers] = useState(draft?.overs ?? '10');
  const [matchType, setMatchType] = useState<'local' | 'domestic'>(draft?.matchType ?? 'local');
  const [location, setLocation] = useState(draft?.location ?? '');

  // Player modal state
  const [playerModal, setPlayerModal] = useState(false);
  const [pendingName, setPendingName] = useState('');
  const [pendingNickname, setPendingNickname] = useState('');
  const [pendingMobile, setPendingMobile] = useState('');
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [pendingPhoto, setPendingPhoto] = useState<string | undefined>(undefined);
  const [selectedRoles, setSelectedRoles] = useState<PlayerRole[]>([]);

  useEffect(() => {
    const data: Draft = {
      step, team1Name, team2Name, activeTeam, team1Players, team2Players, playerInput,
      team1Captain, team2Captain, savedId1, savedId2, overs, matchType, location,
    };
    const noPhotos = (list: Player[]) => list.map(({ photo, ...p }) => p);
    saveDraft(SETUP_DRAFT, 'SetupTeam', data,
      () => ({ ...data, team1Players: noPhotos(team1Players), team2Players: noPhotos(team2Players) }));
  }, [step, team1Name, team2Name, activeTeam, team1Players, team2Players, playerInput,
    team1Captain, team2Captain, savedId1, savedId2, overs, matchType, location]);

  // Scroll to the top when moving between steps (the app's ScrollView content is replaced)
  useEffect(() => { window.scrollTo(0, 0); }, [step]);

  const pickSaved = (n: 1 | 2, team: SharedTeam) => {
    const list = toPlayers(team);
    const captain = list.find(p => p.roles.includes('Captain'))?.name || team.captain;
    if (n === 1) { setTeam1Name(team.name); setTeam1Players(list); setTeam1Captain(captain); setSavedId1(team.id); }
    else { setTeam2Name(team.name); setTeam2Players(list); setTeam2Captain(captain); setSavedId2(team.id); }
    setPickerFor(null);
  };

  // Publish the team being built so other app users can pick it next time
  const saveForEveryone = async () => {
    const name = (activeTeam === 1 ? team1Name : team2Name).trim();
    const list = activeTeam === 1 ? team1Players : team2Players;
    if (list.length < 2) { popup.alert('More Players Needed', 'Add at least 2 players before saving the team.', undefined, 'warning'); return; }
    setSavingTeam(true);
    try {
      const by = (await AsyncStorage.getItem('cricscore_scorer_name').catch(() => null)) || 'Unknown';
      const saved = await createTeam(name, list.map(p => ({ name: p.name, nickname: p.nickname || undefined, mobile: p.mobile, roles: p.roles })), by);
      if (activeTeam === 1) setSavedId1(saved.id); else setSavedId2(saved.id);
      if (saved.pending) {
        popup.alert('Saved on This Phone', `No internet right now. ${name} will be shared with everyone when you sync from Teams.`, undefined, 'warning');
      } else {
        popup.alert('Team Saved', `${name} is now available to everyone in Teams.`, undefined, 'success');
      }
    } catch (e: any) {
      popup.alert('Could Not Save Team', e.message, undefined, 'error');
    } finally {
      setSavingTeam(false);
    }
  };

  const players = activeTeam === 1 ? team1Players : team2Players;
  const setPlayers = activeTeam === 1 ? setTeam1Players : setTeam2Players;

  const captain = activeTeam === 1 ? team1Captain : team2Captain;
  const setCaptain = activeTeam === 1 ? setTeam1Captain : setTeam2Captain;

  const addPlayer = () => {
    if (players.length >= 11) { popup.alert('Team Full', 'A team can have a maximum of 11 players.', undefined, 'warning'); return; }
    setEditingIdx(null);
    setPendingName(playerInput.trim());
    setPendingNickname('');
    setPendingMobile('');
    setPendingPhoto(undefined);
    setSelectedRoles([]);
    setPlayerInput('');
    setPlayerModal(true);
  };

  const editPlayer = (idx: number) => {
    const p = players[idx];
    setEditingIdx(idx);
    setPendingName(p.name);
    setPendingNickname(p.nickname);
    setPendingMobile(p.mobile || '');
    setPendingPhoto(p.photo);
    setSelectedRoles(p.roles);
    setPlayerModal(true);
  };

  const confirmPlayer = () => {
    const name = pendingName.trim();
    const mobile = pendingMobile.replace(/[\s-]/g, '');
    const others = players.filter((_, i) => i !== editingIdx);
    if (!name) { popup.alert('Name Required', 'Please enter the player name.', undefined, 'warning'); return; }
    if (others.some(p => p.name === name)) { popup.alert('Duplicate Player', `${name} is already in this team.`, undefined, 'warning'); return; }
    if (mobile && !/^\+?\d{10,13}$/.test(mobile)) {
      popup.alert('Invalid Mobile No.', 'Enter a valid 10-digit mobile number.', undefined, 'warning'); return;
    }
    if (selectedRoles.length === 0) { popup.alert('Role Required', 'Select at least one role for the player.', undefined, 'warning'); return; }
    if (selectedRoles.includes('Captain') && others.some(p => p.roles.includes('Captain'))) {
      popup.alert('Captain Exists', 'A captain is already assigned to this team.', undefined, 'warning'); return;
    }
    const player: Player = { name, nickname: pendingNickname.trim(), mobile: mobile || undefined, photo: pendingPhoto, roles: selectedRoles };
    if (editingIdx === null) {
      setPlayers([...players, player]);
    } else {
      setPlayers(players.map((p, i) => (i === editingIdx ? player : p)));
    }
    const oldName = editingIdx === null ? null : players[editingIdx].name;
    if (selectedRoles.includes('Captain')) setCaptain(name);
    else if (oldName && captain === oldName) setCaptain('');
    setPlayerModal(false);
  };

  const choosePhoto = (camera: boolean) => {
    pickImage({ camera, maxSize: 400, quality: 0.7 })
      .then(r => { if (r?.uri) setPendingPhoto(r.uri); })
      .catch((e: any) => popup.alert('Photo Error', e?.message, undefined, 'error'));
  };

  const pickPhoto = () => {
    const buttons: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [
      { text: '📷 Camera', onPress: () => choosePhoto(true) },
      { text: '🖼️ Gallery', onPress: () => choosePhoto(false) },
    ];
    if (pendingPhoto) buttons.push({ text: 'Remove Photo', style: 'destructive', onPress: () => setPendingPhoto(undefined) });
    buttons.push({ text: 'Cancel', style: 'cancel' });
    popup.show({ type: 'info', icon: '📸', title: 'Player Photo', message: 'Take a new photo or choose one from your gallery.', buttons });
  };

  const toggleRole = (role: PlayerRole) => {
    setSelectedRoles(prev => prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]);
  };

  const removePlayer = (name: string) => {
    popup.alert('Remove Player?', `${name} will be removed from the team.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => {
        setPlayers(players.filter(p => p.name !== name));
        if (captain === name) setCaptain('');
      }},
    ]);
  };

  const goToPlayers = () => {
    if (!team1Name.trim() || !team2Name.trim()) { popup.alert('Team Names Required', 'Enter names for both teams.', undefined, 'warning'); return; }
    if (team1Name.trim() === team2Name.trim()) { popup.alert('Same Team Names', 'Both teams must have different names.', undefined, 'warning'); return; }
    setStep('players');
  };

  const goToSettings = () => {
    if (team1Players.length < 2) { popup.alert('More Players Needed', `Add at least 2 players to ${team1Name}.`, undefined, 'warning'); setActiveTeam(1); return; }
    if (team2Players.length < 2) { popup.alert('More Players Needed', `Add at least 2 players to ${team2Name}.`, undefined, 'warning'); setActiveTeam(2); return; }
    if (!team1Players.some(p => p.roles.includes('Captain'))) {
      popup.alert('Captain Required', `${team1Name} mein ek Captain hona zaroori hai`, undefined, 'warning');
      setActiveTeam(1); return;
    }
    if (!team2Players.some(p => p.roles.includes('Captain'))) {
      popup.alert('Captain Required', `${team2Name} mein ek Captain hona zaroori hai`, undefined, 'warning');
      setActiveTeam(2); return;
    }
    setStep('settings');
  };

  const startMatch = () => {
    const o = parseInt(overs, 10);
    if (!o || o < 1 || o > 50) { popup.alert('Invalid Overs', 'Overs must be between 1 and 50.', undefined, 'warning'); return; }
    if (!team1Captain) { popup.alert('Captain Required', `Pick a captain for ${team1Name}.`, undefined, 'warning'); return; }
    if (!team2Captain) { popup.alert('Captain Required', `Pick a captain for ${team2Name}.`, undefined, 'warning'); return; }
    navigation.navigate('Bet', {
      team1: { name: team1Name.trim(), players: team1Players.map(p => p.name), playerDetails: team1Players, captain: team1Captain },
      team2: { name: team2Name.trim(), players: team2Players.map(p => p.name), playerDetails: team2Players, captain: team2Captain },
      overs: o, matchType, location: location.trim(),
    });
  };

  const onBack = () => {
    if (step === 'teams') {
      clearDrafts(SETUP_DRAFT, BET_DRAFT); // leaving the setup flow
      navigation.goBack();
    } else {
      setStep(step === 'settings' ? 'players' : 'teams');
    }
  };

  const roleColor = (role: PlayerRole) => {
    if (role === 'Captain') return { bg: C.orangeLight, text: C.orange };
    if (role === 'Keeper') return { bg: C.accentLight, text: C.accent };
    if (role === 'Impact Player') return { bg: '#EDE9FE', text: '#7C3AED' };
    if (role === 'All-Rounder') return { bg: C.greenLight, text: C.green };
    if (role === 'Bowler') return { bg: C.primaryLight, text: C.primary };
    return { bg: C.divider, text: C.textSub };
  };

  const roleBadge = (r: PlayerRole) => {
    const col = roleColor(r);
    return (
      <span key={r} className={s.roleBadge} style={{ backgroundColor: col.bg, color: col.text }}>
        {ALL_ROLES.find(x => x.key === r)?.icon} {r}
      </span>
    );
  };

  const isDone = (i: number) => (step === 'players' && i === 0) || (step === 'settings' && i < 2);

  return (
    <div className={s.container}>
      <div className={s.top}>
        <div className={s.header}>
          <div className={s.headerInner}>
            <button className={s.back} onClick={onBack}>← Back</button>
            <div className={s.headerTitle}>
              {step === 'teams' ? 'Create Match' : step === 'players' ? 'Add Players' : 'Match Settings'}
            </div>
            <div style={{ width: 60 }} />
          </div>
        </div>

        <div className={s.stepRow}>
          {(['teams', 'players', 'settings'] as const).map((st, i) => (
            <div key={st} className={s.stepItem}>
              <div className={`${s.stepCircle} ${step === st ? s.stepCircleActive : ''} ${isDone(i) ? s.stepCircleDone : ''}`}>
                <span className={`${s.stepNum} ${step === st || isDone(i) ? s.stepNumOn : ''}`}>
                  {isDone(i) ? '✓' : i + 1}
                </span>
              </div>
              <span className={`${s.stepLabel} ${step === st ? s.stepLabelActive : ''}`}>
                {st === 'teams' ? 'Teams' : st === 'players' ? 'Players' : 'Settings'}
              </span>
              {i < 2 && <div className={s.stepLine} />}
            </div>
          ))}
        </div>
      </div>

      <div className={s.scroll}>

        {/* STEP 1: Teams */}
        {step === 'teams' && (
          <div className={s.col}>
            <div className={s.sectionTitle}>Match Type</div>
            <div className={s.matchTypeRow}>
              <button className={`${s.matchTypeBtn} ${matchType === 'local' ? s.matchTypeBtnActive : ''}`} onClick={() => setMatchType('local')}>
                <span className={s.matchTypeIcon}>🏘️</span>
                <span className={`${s.matchTypeTitle} ${matchType === 'local' ? s.matchTypeTitleActive : ''}`}>Local Match</span>
                <span className={s.matchTypeDesc}>No extra runs on{`\n`}wide or no ball</span>
                {matchType === 'local' && <span className={s.matchTypeCheck}>✓</span>}
              </button>
              <button className={`${s.matchTypeBtn} ${matchType === 'domestic' ? s.matchTypeBtnActive : ''}`} onClick={() => setMatchType('domestic')}>
                <span className={s.matchTypeIcon}>🏟️</span>
                <span className={`${s.matchTypeTitle} ${matchType === 'domestic' ? s.matchTypeTitleActive : ''}`}>Domestic Match</span>
                <span className={s.matchTypeDesc}>Official rules,{`\n`}extras counted</span>
                {matchType === 'domestic' && <span className={s.matchTypeCheck}>✓</span>}
              </button>
            </div>
            <div className={s.sectionTitle}>Team Names</div>
            <div className={s.card}>
              {([1, 2] as const).map(n => {
                const name = n === 1 ? team1Name : team2Name;
                const count = (n === 1 ? team1Players : team2Players).length;
                const savedId = n === 1 ? savedId1 : savedId2;
                return (
                  <div key={n} className={s.col}>
                    {n === 2 && <div className={s.divider} />}
                    <div className={s.teamLabelRow}>
                      <div className={s.inputLabel}>{n === 1 ? '🏏 Your Team' : '⚔️ Opponent Team'}</div>
                      <button className={s.pickBtn} onClick={() => setPickerFor(n)}>👥 Pick saved team</button>
                    </div>
                    <input
                      className={s.input}
                      placeholder={n === 1 ? 'e.g. Mumbai Indians' : 'e.g. Chennai Super Kings'}
                      value={name}
                      onChange={e => {
                        const v = e.target.value;
                        if (n === 1) { setTeam1Name(v); setSavedId1(undefined); } else { setTeam2Name(v); setSavedId2(undefined); }
                      }}
                    />
                    {!!savedId && <div className={s.loadedText}>✓ Saved team loaded · {count} players</div>}
                  </div>
                );
              })}
              <div className={s.divider} />
              <div className={s.inputLabel}>📍 Match Location</div>
              <input className={s.input} placeholder="e.g. Wankhede Stadium, Mumbai" value={location} onChange={e => setLocation(e.target.value)} />
            </div>
            <button className={s.primaryBtn} onClick={goToPlayers}>Next: Add Players →</button>
          </div>
        )}

        {/* STEP 2: Players */}
        {step === 'players' && (
          <div className={s.col}>
            <div className={s.teamTabs}>
              <button className={`${s.teamTab} ${activeTeam === 1 ? s.teamTabActive : ''}`} onClick={() => setActiveTeam(1)}>
                {team1Name} ({team1Players.length}/11)
              </button>
              <button className={`${s.teamTab} ${activeTeam === 2 ? s.teamTabActive : ''}`} onClick={() => setActiveTeam(2)}>
                {team2Name} ({team2Players.length}/11)
              </button>
            </div>

            <div className={s.card}>
              <div className={s.addRow}>
                <input
                  className={`${s.input} ${s.addInput}`}
                  placeholder="Player name"
                  value={playerInput}
                  onChange={e => setPlayerInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addPlayer(); } }}
                  enterKeyHint="done"
                />
                <button className={s.addBtn} onClick={addPlayer}>+ Add</button>
              </div>
            </div>

            {players.length > 0 && (
              <div className={s.card}>
                {players.map((p, i) => (
                  <div
                    key={p.name}
                    role="button"
                    tabIndex={0}
                    onClick={() => editPlayer(i)}
                    onKeyDown={e => { if (e.key === 'Enter') editPlayer(i); }}
                    className={`${s.playerRow} ${i < players.length - 1 ? s.playerRowBorder : ''}`}>
                    {p.photo
                      ? <img src={p.photo} alt="" className={s.playerAvatar} />
                      : <div className={s.playerNumBadge}><span className={s.playerNum}>{i + 1}</span></div>}
                    <div className={s.playerInfo}>
                      <div className={s.playerName}>{p.name}{p.nickname ? ` (${p.nickname})` : ''}</div>
                      {!!p.mobile && <div className={s.playerMobile}>📱 {p.mobile}</div>}
                      <div className={s.rolesWrap}>{p.roles.map(roleBadge)}</div>
                    </div>
                    <button onClick={e => { e.stopPropagation(); editPlayer(i); }} className={s.editBtn}>✎</button>
                    <button onClick={e => { e.stopPropagation(); removePlayer(p.name); }} className={s.removeBtn}>✕</button>
                  </div>
                ))}
              </div>
            )}

            {players.length > 0 && <div className={s.hintText}>Tap a player to edit name, mobile or role</div>}

            {players.length === 0 && (
              <div className={s.emptyBox}>
                <span className={s.emptyIcon}>👤</span>
                <span className={s.emptyText}>No players added yet</span>
              </div>
            )}

            {players.length >= 2 && !(activeTeam === 1 ? savedId1 : savedId2) && (
              <button className={s.saveTeamBtn} onClick={saveForEveryone} disabled={savingTeam}>
                {savingTeam ? 'Saving…' : `☁️ Save ${(activeTeam === 1 ? team1Name : team2Name) || 'team'} for everyone`}
              </button>
            )}

            <button className={s.primaryBtn} onClick={goToSettings}>Next: Match Settings →</button>
          </div>
        )}

        {/* STEP 3: Settings */}
        {step === 'settings' && (
          <div className={s.col}>
            <div className={s.sectionTitle}>Overs</div>
            <div className={s.card}>
              <div className={s.inputLabel}>Number of Overs per innings</div>
              <div className={s.oversRow}>
                {['5', '10', '20', '50'].map(o => (
                  <button key={o} className={`${s.oversChip} ${overs === o ? s.oversChipActive : ''}`} onClick={() => setOvers(o)}>{o}</button>
                ))}
                <input
                  className={`${s.oversInput} ${!['5', '10', '20', '50'].includes(overs) ? s.oversInputActive : ''}`}
                  placeholder="Custom"
                  inputMode="numeric"
                  value={['5', '10', '20', '50'].includes(overs) ? '' : overs}
                  onChange={e => setOvers(e.target.value)}
                />
              </div>
            </div>

            <div className={s.sectionTitle}>Captains</div>
            {[{ team: team1Name, teamPlayers: team1Players, captain: team1Captain, setCaptain: setTeam1Captain, icon: '🏏' },
              { team: team2Name, teamPlayers: team2Players, captain: team2Captain, setCaptain: setTeam2Captain, icon: '⚔️' },
            ].map(({ team, teamPlayers, captain: cap, setCaptain: setCap, icon }, ti) => (
              <div key={ti} className={s.card} style={ti > 0 ? { marginTop: 12 } : undefined}>
                <div className={s.captainTeamLabel}>{icon} {team} Captain</div>
                {teamPlayers.map(p => (
                  <button key={p.name} className={`${s.captainRow} ${cap === p.name ? s.captainRowActive : ''}`} onClick={() => setCap(p.name)}>
                    <span className={`${s.radio} ${cap === p.name ? s.radioActive : ''}`}>
                      {cap === p.name && <span className={s.radioDot} />}
                    </span>
                    <span className={`${s.captainName} ${cap === p.name ? s.captainNameActive : ''}`}>{p.name}</span>
                    <span className={s.rolesWrap}>{p.roles.slice(0, 2).map(roleBadge)}</span>
                    {cap === p.name && <span className={s.captainBadge}>© Captain</span>}
                  </button>
                ))}
              </div>
            ))}

            <button className={s.primaryBtn} style={{ backgroundColor: C.green, boxShadow: `0 4px 12px ${C.green}4D` }} onClick={startMatch}>
              🏏 Proceed to Bet
            </button>
          </div>
        )}
      </div>

      <TeamPicker
        visible={pickerFor !== null}
        title={pickerFor === 2 ? 'Pick Opponent Team' : 'Pick Your Team'}
        excludeId={pickerFor === 1 ? savedId2 : savedId1}
        onPick={team => pickerFor && pickSaved(pickerFor, team)}
        onClose={() => setPickerFor(null)}
      />

      {/* Player Add Modal */}
      <BottomSheet visible={playerModal} className={s.modalBox}>
        <div className={s.modalTitle}>{editingIdx === null ? '👤 Add Player' : '✎ Edit Player'}</div>

        {/* Photo */}
        <button className={s.photoPickerBtn} onClick={pickPhoto}>
          {pendingPhoto
            ? <img src={pendingPhoto} alt="" className={s.photoPickerImg} />
            : <span className={s.photoPickerPlaceholder}>
                <span className={s.photoPickerIcon}>📷</span>
                <span className={s.photoPickerText}>Add Photo</span>
              </span>}
        </button>

        {/* Name & Nickname */}
        <input
          className={s.modalInput}
          placeholder="Full Name *"
          value={pendingName}
          onChange={e => setPendingName(e.target.value)}
        />
        <input
          className={s.modalInput}
          placeholder="Nickname (optional)"
          value={pendingNickname}
          onChange={e => setPendingNickname(e.target.value)}
        />
        <input
          className={s.modalInput}
          placeholder="📱 Mobile No. (optional)"
          type="tel"
          inputMode="tel"
          maxLength={14}
          value={pendingMobile}
          onChange={e => setPendingMobile(e.target.value)}
        />

        {/* Roles */}
        <div className={s.modalSub}>Select Role(s) *</div>
        <div className={s.rolesGrid}>
          {ALL_ROLES.map(({ key, icon }) => {
            const selected = selectedRoles.includes(key);
            const col = roleColor(key);
            return (
              <button
                key={key}
                className={s.roleBtn}
                style={selected ? { backgroundColor: col.bg, borderColor: col.text + '60' } : undefined}
                onClick={() => toggleRole(key)}>
                <span className={s.roleBtnIcon}>{icon}</span>
                <span className={s.roleBtnText} style={selected ? { color: col.text } : undefined}>{key}</span>
                {selected && <span className={s.roleCheck} style={{ backgroundColor: col.text }}>✓</span>}
              </button>
            );
          })}
        </div>

        <button className={s.confirmBtn} onClick={confirmPlayer}>{editingIdx === null ? 'Add Player →' : 'Save Changes ✓'}</button>
        <button className={s.cancelBtn} onClick={() => setPlayerModal(false)}>Cancel</button>
      </BottomSheet>
    </div>
  );
}
