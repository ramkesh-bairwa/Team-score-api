'use client';
import React, { useEffect, useRef, useState } from 'react';
import { getOverlaySummary, getOverlayLink, getCameraLinks, isLocalAddress, leaveSession, LiveSession } from '@/lib/services/live';
import { popup } from '@/components/Popup';
import ReplayControls from '@/components/ReplayControls';
import WatchLiveCard from '@/components/WatchLiveCard';
import { useBackHandler } from '@/lib/nav';
import { shareText, openUrl } from '@/lib/share';
import s from './LiveStreamScreen.module.css';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

const PRISM_ANDROID = 'com.prism.live';
const STEPS = [
  'Install Prism Live Studio (free) and sign in with your YouTube channel.',
  'In Prism tap Widgets → Web, paste the overlay link below, set size 1280 × 720.',
  'Point this phone\'s camera at the ground and tap Go Live (YouTube).',
  'The score on your stream updates by itself every time the scorer records a ball.',
];

const ballLabel = (b: any, local: boolean) => {
  if (b.wicket) return 'W';
  if (b.extra === 'db') return 'DB';
  if (b.extra === 'wd' || b.extra === 'nb') {
    const taken = local ? b.runs : b.runs - 1;
    return `${b.extra === 'wd' ? 'Wd' : 'Nb'}${taken > 0 ? '+' + taken : ''}`;
  }
  if (b.extra === 'lb') return `Lb${b.runs}`;
  if (b.extra === 'b') return `B${b.runs}`;
  return String(b.runs);
};

// The second device of a match: shows the live score in real time and connects the stream to YouTube.
// It can never score (the server blocks it).
export default function LiveStreamScreen({ navigation, route }: any) {
  const { code, token, name } = route.params as { code: string; token: string; name: string };
  const session: LiveSession = { code, token, role: 'scorer' };
  const [d, setD] = useState<any>(null);
  const [status, setStatus] = useState<'connecting' | 'live' | 'lost' | 'ended'>('connecting');
  const [overlayUrl, setOverlayUrl] = useState('');
  const [camera, setCamera] = useState<{ studioUrl: string; watchUrl: string } | null>(null);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [flashKey, setFlashKey] = useState(0); // restarts the flash animation for back-to-back boundaries
  const lastDeliveries = useRef<number | null>(null);

  // Real-time score: poll the same feed the YouTube overlay uses, every second
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const data = await getOverlaySummary(code);
        if (!alive) return;
        setD(data);
        setStatus('live');
        if (lastDeliveries.current !== null && data.deliveries > lastDeliveries.current && data.lastBall) {
          const b = data.lastBall;
          const kind = b.wicket ? 'WICKET!' : !b.extra && b.runs === 6 ? 'SIX!' : !b.extra && b.runs === 4 ? 'FOUR!' : null;
          if (kind) {
            setFlash(kind);
            setFlashKey(k => k + 1);
          }
        }
        lastDeliveries.current = data.deliveries ?? lastDeliveries.current;
      } catch (e: any) {
        if (alive) setStatus(e.status === 404 ? 'ended' : 'lost');
      }
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => { alive = false; clearInterval(t); };
  }, [code]);

  useEffect(() => {
    getOverlayLink(session).then(setOverlayUrl).catch(() => {});
  }, [code]);

  const disconnect = () => {
    popup.show({
      type: 'warning', icon: '📺', title: 'Stop Live Stream Device?',
      message: 'This phone will disconnect from the match. The scorer can then connect another stream phone.',
      buttons: [
        { text: 'Stay', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: () => {
          leaveSession(code, token).catch(() => {});
          navigation.navigate('Home');
        }},
      ],
    });
  };

  useBackHandler(() => { disconnect(); return true; });

  // Built-in streaming: this phone's browser films, adds the scoreboard, streams and records
  const loadCamera = async () => {
    setCameraBusy(true);
    setCameraError(null);
    try {
      const links = await getCameraLinks(session);
      setCamera(links);
      return links;
    } catch (e: any) {
      setCameraError(e.message);
      return null;
    } finally {
      setCameraBusy(false);
    }
  };

  const openCameraStudio = async () => {
    // Open the tab now, while the click still counts as a user action (browsers block pop-ups
    // opened after an await), then point it at the fresh link once it arrives.
    let win: Window | null = null;
    try { win = window.open('', '_blank'); } catch { win = null; }
    // Fetch a fresh link each time: it signs the browser in and expires after a day
    const links = await loadCamera();
    if (!links) { win?.close(); return; }
    try {
      if (win && !win.closed) {
        win.opener = null;
        win.location.href = links.studioUrl;
      } else {
        openUrl(links.studioUrl);
      }
    } catch {
      setCameraError('Could not open the browser on this phone.');
    }
  };

  const openPrism = () => {
    // market:// links only work inside the Android app; the web opens the Play Store page
    openUrl(`https://play.google.com/store/apps/details?id=${PRISM_ANDROID}`);
  };

  const local = d?.matchType === 'local';
  const totalBalls = d ? d.over * 6 + d.ball : 0;
  const crr = totalBalls ? ((d.runs / totalBalls) * 6).toFixed(2) : '0.00';
  let statusLine = '';
  if (d?.phase === 'scoring') {
    if (d.target) {
      const need = Math.max(0, d.target - d.runs);
      const left = Math.max(0, d.overs * 6 - totalBalls);
      statusLine = need === 0 ? `${d.battingTeam} have reached the target!` : `Need ${need} run${need === 1 ? '' : 's'} in ${left} ball${left === 1 ? '' : 's'}`;
    } else {
      statusLine = `CRR ${crr}${totalBalls ? ` · Projected ${Math.round((d.runs / totalBalls) * d.overs * 6)}` : ''}`;
    }
  } else if (d?.phase === 'innings_end') {
    statusLine = d.result || `Innings break · ${d.bowlingTeam} need ${d.runs + 1} to win`;
  }

  return (
    <div className={s.container}>
      <div className={s.header}>
        <div className={s.headerInner}>
          <button type="button" onClick={disconnect} className={cx(s.btnReset, s.headerBtn)}><span className={s.headerBtnText}>✕</span></button>
          <div className={s.headerMid}>
            <div className={cx(s.headerTitle, s.one)}>📺 Live Stream Device</div>
            <div className={cx(s.headerSub, s.one)}>Match {code} · {name}</div>
          </div>
          <div className={cx(s.livePill, status !== 'live' && s.livePillOff)}>
            <div className={cx(s.liveDot, status !== 'live' && s.liveDotOff)} />
            <span className={s.livePillText}>{status === 'live' ? 'LIVE' : status === 'ended' ? 'ENDED' : '…'}</span>
          </div>
        </div>
      </div>

      <div className={s.scrollArea}>
        <div className={s.scroll}>
          <div className={s.colMain}>
          {/* Real-time score */}
          <div className={s.scoreCard}>
            {status === 'ended' ? (
              <div className={s.waiting}>This match has ended or the code expired.</div>
            ) : !d || d.phase === 'waiting' ? (
              <div className={s.waiting}>{status === 'lost' ? '📡 Reconnecting…' : 'Waiting for the scorer to start…'}</div>
            ) : (
              <>
                <div className={s.teamLine}>{d.battingTeam} <span className={s.vs}>v {d.bowlingTeam}</span></div>
                <div className={s.scoreRow}>
                  <div className={s.score}>{d.runs}<span className={s.wkts}>/{d.wickets}</span></div>
                  <div className={s.overs}>{d.over}.{d.ball}<span className={s.oversOf}> / {d.overs} ov</span></div>
                </div>
                {!!statusLine && <div className={s.statusLine}>{statusLine}</div>}
                {d.phase === 'scoring' && (
                  <>
                    {[d.striker, d.nonStriker].filter(Boolean).map((b: any, i: number) => (
                      <div key={b.name} className={s.playerRow}>
                        <div className={cx(s.playerName, s.one, i === 0 && s.onStrike)}>{b.name}{i === 0 ? ' *' : ''}</div>
                        <div className={s.playerRuns}>{b.runs} <span className={s.playerBalls}>({b.balls})</span></div>
                      </div>
                    ))}
                    {d.bowler && (
                      <div className={cx(s.playerRow, s.bowlerRow)}>
                        <div className={cx(s.playerName, s.one)}>🎳 {d.bowler.name}</div>
                        <div className={s.playerRuns}>{d.bowler.wickets}-{d.bowler.runs} <span className={s.playerBalls}>({d.bowler.overs}.{d.bowler.balls})</span></div>
                      </div>
                    )}
                    <div className={s.overRow}>
                      {(d.thisOver || []).map((b: any, i: number) => (
                        <div key={i} className={cx(s.chip, b.wicket && s.chipW, !b.extra && b.runs === 4 && s.chip4, !b.extra && b.runs === 6 && s.chip6)}>
                          <span className={s.chipText}>{ballLabel(b, local)}</span>
                        </div>
                      ))}
                    </div>
                    {!!d.lastCommentary && <div className={s.commentary}>🎙️ {d.lastCommentary}</div>}
                  </>
                )}
              </>
            )}
            {flash && (
              <div key={flashKey} className={s.flash} onAnimationEnd={() => setFlash(null)}>
                <div className={s.flashText}>{flash}</div>
              </div>
            )}
          </div>

          {/* Replays on the camera stream, right under the live score */}
          {status !== 'ended' && <ReplayControls session={session} />}

          {/* Viewers: QR / code / link to the watch page */}
          <WatchLiveCard code={code} title={d?.battingTeam && d?.bowlingTeam ? `${d.battingTeam} vs ${d.bowlingTeam}` : undefined} />
          </div>

          <div className={s.colSide}>

          {/* Built-in camera stream */}
          <div className={s.card}>
            <div className={s.ytHead}>
              <div className={cx(s.ytLogo, s.camLogo)}><span className={s.ytLogoText}>●</span></div>
              <div className={s.cardTitle}>Stream from this phone&apos;s camera</div>
            </div>
            <div className={s.stepText}>
              No extra app needed. Opens the camera studio in your browser with the live scoreboard on the video.
              Viewers watch with a link, and when you end the stream you can upload the recording to YouTube.
            </div>
            {cameraError && <div className={s.camError}>⛔ {cameraError}</div>}
            {!!camera && isLocalAddress(camera.studioUrl) && (
              <div className={s.camWarn}>
                ⚠️ The server address is not https, so the browser will block the camera. Run server/scripts/go-live.sh on
                the computer and use the https address it prints (⚙️ on the Home screen).
              </div>
            )}
            <button type="button" className={cx(s.btnReset, s.btn, s.btnRed, cameraBusy && s.btnBusy)} disabled={cameraBusy} onClick={openCameraStudio}>
              <span className={s.btnText}>{cameraBusy ? 'Opening…' : '🎥 Open Camera Studio'}</span>
            </button>
            <button
              type="button"
              className={cx(s.btnReset, s.btn, s.btnBlue, cameraBusy && s.btnBusy)}
              disabled={cameraBusy}
              onClick={async () => {
                const links = camera ?? (await loadCamera());
                if (links) shareText(`Watch the match live: ${links.watchUrl}`).catch(() => {});
              }}
            >
              <span className={s.btnText}>Share Watch Link</span>
            </button>
          </div>

          {/* YouTube */}
          <div className={s.card}>
            <div className={s.ytHead}>
              <div className={s.ytLogo}><span className={s.ytLogoText}>▶</span></div>
              <div className={s.cardTitle}>Go live on YouTube</div>
            </div>
            {STEPS.map((step, i) => (
              <div key={i} className={s.step}>
                <div className={s.stepNum}><span className={s.stepNumText}>{i + 1}</span></div>
                <div className={s.stepText}>{step}</div>
              </div>
            ))}
            <div className={s.linkBox}>
              <div className={s.linkLabel}>OVERLAY LINK</div>
              <div className={s.link}>{overlayUrl || 'Loading…'}</div>
            </div>
            <div className={s.btnRow}>
              <button type="button" className={cx(s.btnReset, s.btn, s.btnBlue)} disabled={!overlayUrl} onClick={() => shareText(overlayUrl).catch(() => {})}>
                <span className={s.btnText}>Copy / Share Link</span>
              </button>
              <button type="button" className={cx(s.btnReset, s.btn, s.btnDark)} onClick={openPrism}>
                <span className={s.btnText}>Get Prism</span>
              </button>
            </div>
            <button type="button" className={cx(s.btnReset, s.btn, s.btnRed)} onClick={() => openUrl('https://studio.youtube.com')}>
              <span className={s.btnText}>Open YouTube Studio</span>
            </button>
          </div>

          </div>

          <div className={s.footnote}>
            Only 2 phones can be connected to a match: the scorer and this live-stream phone. This phone can&apos;t change the score.
          </div>
        </div>
      </div>
    </div>
  );
}
