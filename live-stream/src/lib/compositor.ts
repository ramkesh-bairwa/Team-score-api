import type { LiveScore, ScoreBall } from '@/types/score';

// Draws the camera onto a canvas, with TV-style match graphics on top. The canvas stream is what
// viewers receive and what gets recorded, so the graphics are "burned in" and the outgoing track
// never changes when the camera is flipped or a replay is put on air.
//
// Two layouts: landscape (1280×720) with a one-row lower third, and portrait (720×1280, a phone
// held upright) with a stacked lower third. The layout follows the camera until the stream goes
// live, then stays fixed so the recording keeps one resolution.

const LANDSCAPE = { w: 1280, h: 720 };
const PORTRAIT = { w: 720, h: 1280 };
const FPS = 30;
const FONT = '"Barlow Condensed", "Arial Narrow", "Roboto Condensed", sans-serif';
const FONT_URL =
  'https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,600;0,700;0,800;0,900;1,800;1,900&display=swap';

const C = {
  ink: '#050A18',
  panel: '#0B1530',
  panel2: '#13204A',
  line: 'rgba(255,255,255,.10)',
  gold: '#FFC531',
  gold2: '#F59E0B',
  red: '#E11D2E',
  muted: '#93A3C6',
  soft: '#D3DBEE',
  four: '#1E6BFF',
  six: '#8B2CF5',
  extra: '#F97316',
};

// Team colours: stable per team name (same palette and hash as the browser overlay)
const PALETTE: [string, string][] = [
  ['#1D4ED8', '#0F2A7A'], ['#DC2626', '#7F1D1D'], ['#7C3AED', '#3B0F7A'], ['#059669', '#064E3B'],
  ['#EA580C', '#7C2D12'], ['#DB2777', '#701A43'], ['#0891B2', '#0C4A5E'], ['#CA8A04', '#713F12'],
];
const colorIdx = (name = '') => {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % PALETTE.length;
};

// [main, dark] colour of a team, as used on the scoreboard
export const teamColor = (name = '') => PALETTE[colorIdx(name)];
// Colours for two teams side by side: the second moves to the next colour if they'd clash
export const matchColors = (a = '', b = ''): [[string, string], [string, string]] => {
  const ia = colorIdx(a);
  let ib = colorIdx(b);
  if (ib === ia) ib = (ib + 1) % PALETTE.length;
  return [PALETTE[ia], PALETTE[ib]];
};

export const abbr = (name = '') => {
  const w = name.trim().split(/\s+/).filter(Boolean);
  if (!w.length) return '—';
  if (w.length > 1) return w.map((x) => x[0]).join('').slice(0, 4).toUpperCase();
  return w[0].slice(0, 3).toUpperCase();
};

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

const ballLabel = (b: ScoreBall, matchType: string) => {
  if (b.wicket) return 'W';
  if (b.extra === 'db') return 'DB';
  if (b.extra === 'wd' || b.extra === 'nb') {
    const taken = matchType === 'local' ? b.runs : b.runs - 1;
    return (b.extra === 'wd' ? 'wd' : 'nb') + (taken > 0 ? `+${taken}` : '');
  }
  if (b.extra === 'lb') return `${b.runs}lb`;
  if (b.extra === 'b') return `${b.runs}b`;
  return String(b.runs);
};

// [fill, text] of a ball chip in the this-over strip
const ballStyle = (b: ScoreBall): [string, string] => {
  if (b.wicket) return [C.red, '#fff'];
  if (b.extra === 'db') return ['#475569', '#E2E8F0'];
  if (b.extra) return [C.extra, '#fff'];
  if (b.runs === 6) return [C.six, '#fff'];
  if (b.runs === 4) return [C.four, '#fff'];
  if (b.runs === 0) return ['rgba(255,255,255,.14)', C.muted];
  return ['#F1F5FF', '#0B1530'];
};

type BannerKind = '4' | '6' | 'w' | 'm';
interface Banner {
  kind: BannerKind;
  title: string;
  sub: string;
  start: number;
  sparks: { a: number; d: number; r: number; delay: number; color: string }[];
}
const BANNER_MS = 3400;
const BANNER_STYLE: Record<BannerKind, [string, string, string]> = {
  '4': ['#0A2E8A', C.four, '#4F8CFF'],
  '6': ['#3B0A7A', C.six, '#B46CFF'],
  w: ['#5C0011', C.red, '#FF5A6E'],
  m: ['#7A4A00', C.gold2, '#FFE08A'],
};

// What the compositor needs from a replay in progress (see lib/replay.ts)
export interface ReplaySource {
  // The frame to show, or null while the next one is still loading
  frame(): HTMLVideoElement | null;
  progress(): number; // 0..1
  rate: number;
}

const STING_MS = 650;

type Box = { x: number; y: number; w: number; h: number };

export class Compositor {
  readonly canvas: HTMLCanvasElement;
  readonly stream: MediaStream;
  private ctx: CanvasRenderingContext2D;
  private video: HTMLVideoElement;
  private timer: ReturnType<typeof setInterval>;
  private W = LANDSCAPE.w;
  private H = LANDSCAPE.h;
  private locked = false;
  private onResize: ((w: number, h: number) => void) | null = null;
  private cameraOn = true;
  private live = false;
  private score: LiveScore | null = null;
  private lastDeliveries: number | null = null;
  private seenRuns = new Map<string, number>();
  private banners: Banner[] = [];
  private prevScoreText: string | null = null;
  private bumpAt = 0;
  private replay: ReplaySource | null = null;
  private sting = 0; // start time of the replay in/out wipe
  // Last replay frame, held while the next replay clip loads so the picture never flashes black
  private hold: HTMLCanvasElement;
  private holdValid = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.W;
    this.canvas.height = this.H;
    this.ctx = this.canvas.getContext('2d')!;
    this.hold = document.createElement('canvas');
    this.hold.width = this.W;
    this.hold.height = this.H;
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    loadFont();
    this.draw();
    this.stream = this.canvas.captureStream(FPS);
    // setInterval keeps drawing (slowly) even when the tab isn't focused; rAF would stop entirely
    this.timer = setInterval(() => this.draw(), 1000 / FPS);
  }

  get portrait() {
    return this.H > this.W;
  }

  setSource(stream: MediaStream) {
    this.video.srcObject = stream;
    this.video.play().catch(() => {});
  }

  setCameraOn(on: boolean) {
    this.cameraOn = on;
  }

  // Burned-in LIVE badge; going live also fixes the layout (the recording keeps one resolution)
  setLive(live: boolean) {
    this.live = live;
    if (live) this.locked = true;
  }

  // Called when the canvas switches between landscape and portrait (before going live)
  onLayoutChange(fn: ((w: number, h: number) => void) | null) {
    this.onResize = fn;
    fn?.(this.W, this.H);
  }

  setReplay(replay: ReplaySource | null) {
    if (!!replay !== !!this.replay) this.sting = Date.now();
    // Never show a frame left over from an earlier replay
    if (replay !== this.replay) this.holdValid = false;
    this.replay = replay;
  }

  setScore(score: LiveScore | null) {
    const d = score?.deliveries;
    const isNew = !!(score && d != null && this.lastDeliveries != null && d > this.lastDeliveries && score.lastBall);
    if (isNew) {
      const b = score!.lastBall!;
      const sub = score!.lastCommentary || '';
      if (b.wicket) this.pushBanner('w', 'WICKET', sub);
      else if (!b.extra && b.runs === 6) this.pushBanner('6', 'SIX', sub);
      else if (!b.extra && b.runs === 4) this.pushBanner('4', 'FOUR', sub);
    }
    // Milestones for the batters at the crease
    for (const p of [score?.striker, score?.nonStriker]) {
      if (!p) continue;
      const prev = this.seenRuns.get(p.name);
      if (prev != null && isNew) {
        if (prev < 100 && p.runs >= 100) this.pushBanner('m', 'CENTURY', `${p.name}  ${p.runs} (${p.balls})`);
        else if (prev < 50 && p.runs >= 50) this.pushBanner('m', 'FIFTY', `${p.name}  ${p.runs} (${p.balls})`);
      }
      this.seenRuns.set(p.name, p.runs);
    }
    if (d != null) this.lastDeliveries = d;
    if (score?.phase === 'innings_end') this.lastDeliveries = null;

    const text = score ? `${score.runs ?? 0}/${score.wickets ?? 0}` : null;
    if (this.prevScoreText !== null && text !== null && text !== this.prevScoreText) this.bumpAt = Date.now();
    this.prevScoreText = text;
    this.score = score;
  }

  destroy() {
    clearInterval(this.timer);
    this.stream.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
    this.onResize = null;
  }

  private pushBanner(kind: BannerKind, title: string, sub: string) {
    const colors = kind === '6' ? ['#fff', '#C084FC', C.gold] : ['#fff', C.gold, C.gold2];
    const sparks =
      kind === '6' || kind === 'm'
        ? Array.from({ length: 36 }, (_, i) => ({
            a: Math.random() * Math.PI * 2,
            d: 180 + Math.random() * 420,
            r: Math.random() * 12 - 6,
            delay: 250 + Math.random() * 250,
            color: colors[i % colors.length],
          }))
        : [];
    this.banners.push({ kind, title, sub, start: 0, sparks });
  }

  // Follow the camera's orientation until the stream goes live
  private fitLayout() {
    if (this.locked || !this.video.videoWidth) return;
    const want = this.video.videoHeight > this.video.videoWidth * 1.1 ? PORTRAIT : LANDSCAPE;
    if (want.w === this.W) return;
    this.W = this.canvas.width = this.hold.width = want.w;
    this.H = this.canvas.height = this.hold.height = want.h;
    this.holdValid = false;
    this.onResize?.(this.W, this.H);
  }

  private draw() {
    this.fitLayout();
    const { ctx, W, H } = this;
    const now = Date.now();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    const rv = this.replay?.frame();
    if (rv && rv.videoWidth && rv.readyState >= 2) {
      drawFit(ctx, rv, W, H);
      this.hold.getContext('2d')!.drawImage(this.canvas, 0, 0);
      this.holdValid = true;
    } else if (this.replay && this.holdValid) {
      // Between clips: keep the last replay frame rather than flashing black
      ctx.drawImage(this.hold, 0, 0);
    } else if (this.cameraOn && this.video.videoWidth) {
      drawFit(ctx, this.video, W, H);
    } else if (!this.cameraOn) {
      ctx.fillStyle = '#18181b';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#a1a1aa';
      ctx.font = f(700, 40);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Camera paused', W / 2, H / 2);
    }

    const s = this.score;
    const hasScore = !!s && s.phase !== 'waiting';
    // The score strip already names both teams; the top bug keeps them only for the innings card
    this.drawTopBug(hasScore && s.phase === 'innings_end' ? s : null, now);
    if (s && hasScore) {
      if (s.phase === 'innings_end') this.drawCard(s);
      else if (this.portrait) this.drawBoardPortrait(s, now);
      else this.drawBoardLandscape(s, now);
    }
    if (this.replay) this.drawReplayTag(this.replay, now);
    this.drawBanner(now);
    if (now - this.sting < STING_MS) this.drawSting((now - this.sting) / STING_MS);
  }

  // ── Top-left: LIVE + match ───────────────────────────────────────
  private drawTopBug(s: LiveScore | null, now: number) {
    // During a replay the REPLAY badge takes over; LIVE would be misleading
    if (this.replay || (!this.live && !s)) return;
    const { ctx } = this;
    const m = this.portrait ? 20 : 26;
    const h = this.portrait ? 40 : 38;
    let x = m;
    const y = m;
    ctx.save();
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    if (this.live) {
      ctx.font = f(900, 22);
      spacing(ctx, 2);
      const w = ctx.measureText('LIVE').width + 48;
      shadow(ctx, 0.45, 14, 4);
      ctx.fillStyle = vGrad(ctx, y, h, '#F43F4E', C.red);
      rr(ctx, x, y, w, h, 6);
      ctx.fill();
      noShadow(ctx);
      const pulse = 0.5 + 0.5 * Math.sin((now / 1000) * Math.PI * 1.6);
      ctx.beginPath();
      ctx.arc(x + 17, y + h / 2, 9 + pulse * 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${0.25 * (1 - pulse)})`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x + 17, y + h / 2, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.fillText('LIVE', x + 30, y + h / 2 + 1);
      spacing(ctx, 0);
      x += w + 8;
    }
    if (s) {
      const bat = abbr(s.battingTeam);
      const bowl = abbr(s.bowlingTeam);
      const [cBat, cBowl] = matchColors(s.battingTeam, s.bowlingTeam);
      ctx.font = f(800, 21);
      spacing(ctx, 1.2);
      const tBat = ctx.measureText(bat).width;
      const tV = ctx.measureText(' v ').width;
      const tBowl = ctx.measureText(bowl).width;
      const inn = this.portrait ? '' : `${s.inningsNum === 2 ? '2ND' : '1ST'} INN${s.overs ? ` · ${s.overs} OV` : ''}`;
      ctx.font = f(700, 16);
      const tInn = inn ? ctx.measureText(inn).width + 24 : 0;
      const w = 20 + tBat + tV + tBowl + 16 + tInn;
      shadow(ctx, 0.4, 14, 4);
      ctx.fillStyle = 'rgba(8,14,34,.88)';
      rr(ctx, x, y, w, h, 6);
      ctx.fill();
      noShadow(ctx);
      ctx.fillStyle = cBat[0];
      ctx.fillRect(x, y + h - 4, 10 + tBat + tV / 2, 4);
      ctx.fillStyle = cBowl[0];
      ctx.fillRect(x + 10 + tBat + tV / 2, y + h - 4, tV / 2 + tBowl + 10, 4);
      ctx.font = f(800, 21);
      ctx.fillStyle = '#fff';
      ctx.fillText(bat, x + 10, y + h / 2);
      ctx.fillStyle = C.muted;
      ctx.fillText(' v ', x + 10 + tBat, y + h / 2);
      ctx.fillStyle = '#fff';
      ctx.fillText(bowl, x + 10 + tBat + tV, y + h / 2);
      if (inn) {
        const ix = x + 20 + tBat + tV + tBowl + 6;
        ctx.fillStyle = C.line;
        ctx.fillRect(ix, y + 9, 1, h - 18);
        ctx.font = f(700, 16);
        ctx.fillStyle = C.soft;
        ctx.fillText(inn, ix + 12, y + h / 2 + 1);
      }
      spacing(ctx, 0);
    }
    ctx.restore();
  }

  // ── Lower third, landscape: one TV strip right across the bottom ──
  // [bat badge][TEAM score overs / v OPP status][batters][this over][bowler / rate][bowl badge]
  private drawBoardLandscape(s: LiveScore, now: number) {
    const { ctx, W, H } = this;
    const h = 84;
    const y = H - h - 18;
    const [bat, bowl] = matchColors(s.battingTeam, s.bowlingTeam);
    ctx.save();
    shadow(ctx, 0.5, 20, 4);
    ctx.fillStyle = '#060608';
    ctx.fillRect(0, y, W, h + 8);
    noShadow(ctx);
    let x = 0;
    const seg = (w: number) => {
      const b: Box = { x, y, w, h };
      x += w;
      return b;
    };
    this.drawBadge(s.battingTeam, bat, seg(104));
    this.drawInfo(s, seg(300), now);
    this.drawBattersBug(s, seg(290), bat);
    this.drawOverBug(s, seg(170));
    this.drawBowlerBug(s, seg(W - x - 104), bowl);
    this.drawBadge(s.bowlingTeam, bowl, seg(W - x));
    ctx.restore();
  }

  // ── Lower third, portrait: the same strip, stacked in three rows ──
  private drawBoardPortrait(s: LiveScore, now: number) {
    const { ctx, W, H } = this;
    const rowA = 80;
    const rowB = 84;
    const rowC = 48;
    const y = H - rowA - rowB - rowC - 28;
    const [bat, bowl] = matchColors(s.battingTeam, s.bowlingTeam);
    ctx.save();
    shadow(ctx, 0.5, 20, 4);
    ctx.fillStyle = '#060608';
    ctx.fillRect(0, y, W, rowA + rowB + rowC + 8);
    noShadow(ctx);
    this.drawBadge(s.battingTeam, bat, { x: 0, y, w: 96, h: rowA });
    this.drawInfo(s, { x: 96, y, w: W - 192, h: rowA }, now);
    this.drawBadge(s.bowlingTeam, bowl, { x: W - 96, y, w: 96, h: rowA });
    this.drawBattersBug(s, { x: 0, y: y + rowA, w: W / 2, h: rowB }, bat);
    this.drawBowlerBug(s, { x: W / 2, y: y + rowA, w: W / 2, h: rowB }, bowl);
    this.drawOverBug(s, { x: 0, y: y + rowA + rowB, w: W, h: rowC });
    ctx.restore();
  }

  // Team badge: a disc in the team colour with its short name, on a darker tile
  private drawBadge(team: string | undefined, col: [string, string], b: Box) {
    const { ctx } = this;
    ctx.fillStyle = vGrad(ctx, b.y, b.h, col[1], '#0B0B10');
    ctx.fillRect(b.x, b.y, b.w, b.h);
    const r = Math.min(b.w, b.h) * 0.38;
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = vGrad(ctx, cy - r, r * 2, col[0], col[1]);
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = C.gold;
    ctx.stroke();
    const name = abbr(team);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.font = f(900, r * (name.length > 3 ? 0.62 : 0.78));
    ctx.fillText(name, cx, cy + 1);
  }

  // Dark panel: TEAM [runs-wkts] overs on top, "v OPP" and the match situation underneath
  private drawInfo(s: LiveScore, b: Box, now: number) {
    const { ctx } = this;
    ctx.fillStyle = vGrad(ctx, b.y, b.h, '#34343C', '#141418');
    ctx.fillRect(b.x, b.y, b.w, b.h);
    const top = b.y + b.h * 0.34;
    const low = b.y + b.h * 0.77;
    const big = b.h * 0.4;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    const team = abbr(s.battingTeam);
    ctx.font = f(900, big * 0.9);
    spacing(ctx, 1);
    ctx.fillStyle = '#fff';
    ctx.fillText(team, b.x + 14, top + 1);
    const teamW = ctx.measureText(team).width;
    spacing(ctx, 0);

    // red score box, bumping when the score changes
    const text = `${s.runs ?? 0}-${s.wickets ?? 0}`;
    ctx.font = f(900, big);
    const tw = ctx.measureText(text).width;
    const bx = b.x + 14 + teamW + 12;
    const bh = b.h * 0.5;
    const bw = tw + 22;
    ctx.fillStyle = vGrad(ctx, top - bh / 2, bh, '#F0303F', '#B5121F');
    ctx.fillRect(bx, top - bh / 2, bw, bh);
    const bt = now - this.bumpAt;
    const scale = bt < 550 ? 1 + 0.14 * Math.sin((Math.PI * bt) / 550) : 1;
    ctx.save();
    ctx.translate(bx + bw / 2, top + 1);
    ctx.scale(scale, scale);
    ctx.textAlign = 'center';
    ctx.fillStyle = bt < 400 ? C.gold : '#fff';
    ctx.fillText(text, 0, 0);
    ctx.restore();

    ctx.font = f(700, big * 0.78);
    ctx.fillStyle = '#fff';
    ctx.fillText(`${s.over ?? 0}.${s.ball ?? 0}`, bx + bw + 12, top + 1);

    // underneath: v OPP · situation
    const small = b.h * 0.25;
    ctx.font = f(700, small);
    ctx.fillStyle = C.muted;
    const opp = `v ${abbr(s.bowlingTeam)}`;
    ctx.fillText(opp, b.x + 14, low);
    const ox = b.x + 14 + ctx.measureText(opp).width + 14;
    let status: string;
    let hl = false;
    if (s.target) {
      const need = Math.max(0, s.target - (s.runs ?? 0));
      const left = Math.max(0, (s.overs ?? 0) * 6 - (s.over ?? 0) * 6 - (s.ball ?? 0));
      status = need ? `NEED ${need} OFF ${plural(left, 'BALL').toUpperCase()}` : 'TARGET REACHED';
      hl = true;
    } else {
      status = `${s.inningsNum === 2 ? '2ND' : '1ST'} INNINGS${s.overs ? ` · ${s.overs} OVERS` : ''}`;
    }
    ctx.font = f(800, small);
    spacing(ctx, 1);
    ctx.fillStyle = hl ? C.gold : '#fff';
    ctx.fillText(truncate(ctx, status, b.x + b.w - 10 - ox), ox, low);
    spacing(ctx, 0);
  }

  // Batting-team panel: striker (with bat) over non-striker, NAME runs balls
  private drawBattersBug(s: LiveScore, b: Box, col: [string, string]) {
    const { ctx } = this;
    this.glossy(b, col);
    const rows = [
      [s.striker ?? null, true],
      [s.nonStriker ?? null, false],
    ] as const;
    rows.forEach(([p, strike], i) => {
      if (!p) return;
      const cy = b.y + b.h * (i ? 0.73 : 0.29);
      this.drawStatRow(b, cy, p.name, String(p.runs), String(p.balls), strike ? 'bat' : null);
    });
  }

  // Bowling-team panel: bowler wickets-runs overs, then the run rate that matters
  private drawBowlerBug(s: LiveScore, b: Box, col: [string, string]) {
    this.glossy(b, col);
    if (s.bowler) {
      const bw = s.bowler;
      this.drawStatRow(b, b.y + b.h * 0.29, bw.name, `${bw.wickets}-${bw.runs}`, `${bw.overs}.${bw.balls}`, 'ball');
    }
    const balls = (s.over ?? 0) * 6 + (s.ball ?? 0);
    const runs = s.runs ?? 0;
    let label = 'CURRENT RATE';
    let rate = balls ? ((runs / balls) * 6).toFixed(2) : '0.00';
    if (s.target) {
      const need = Math.max(0, s.target - runs);
      const left = Math.max(0, (s.overs ?? 0) * 6 - balls);
      if (need && left) {
        label = 'REQUIRED RATE';
        rate = ((need / left) * 6).toFixed(2);
      }
    }
    this.drawStatRow(b, b.y + b.h * 0.73, label, rate, '', null);
  }

  // NAME ........ big small, inside a coloured panel
  private drawStatRow(b: Box, cy: number, name: string, big: string, small: string, icon: 'bat' | 'ball' | null) {
    const { ctx } = this;
    const size = b.h * 0.34;
    const r = b.x + b.w - 14;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.font = f(700, size * 0.72);
    ctx.fillText(small, r, cy + 2);
    const smallW = small ? Math.max(ctx.measureText(small).width, ctx.measureText('00').width) + 12 : 0;
    ctx.font = f(900, size);
    ctx.fillStyle = '#fff';
    ctx.fillText(big, r - smallW, cy);
    const bigW = ctx.measureText(big).width;
    let nx = b.x + 14;
    if (icon === 'bat') batIcon(ctx, nx + 8, cy, size * 0.9);
    if (icon === 'ball') ballIcon(ctx, nx + 8, cy);
    if (icon) nx += 24;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'left';
    ctx.font = f(800, size * 0.84);
    spacing(ctx, 0.5);
    ctx.fillText(truncate(ctx, name.toUpperCase(), r - smallW - bigW - 14 - nx), nx, cy + 1);
    spacing(ctx, 0);
  }

  // Grey middle panel: this over's balls
  private drawOverBug(s: LiveScore, b: Box) {
    const { ctx } = this;
    ctx.fillStyle = vGrad(ctx, b.y, b.h, '#5A5A64', '#2E2E36');
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.fillRect(b.x, b.y, 2, b.h);
    ctx.fillRect(b.x + b.w - 2, b.y, 2, b.h);
    // Narrow (landscape): label on top, balls below. Wide (portrait): label left, balls beside it
    const wide = b.w > 300;
    const d = wide ? b.h * 0.62 : b.h * 0.3;
    const gap = wide ? 8 : 4;
    ctx.font = f(800, wide ? 17 : 14);
    spacing(ctx, 1.4);
    ctx.fillStyle = '#E4E4EA';
    ctx.textBaseline = 'middle';
    ctx.textAlign = wide ? 'left' : 'center';
    const cy = wide ? b.y + b.h / 2 : b.y + b.h * 0.7;
    ctx.fillText('THIS OVER', wide ? b.x + 18 : b.x + b.w / 2, wide ? cy + 1 : b.y + b.h * 0.27);
    const labelW = wide ? ctx.measureText('THIS OVER').width + 34 : 10;
    spacing(ctx, 0);

    const matchType = s.matchType || 'local';
    const chips = (s.thisOver ?? []).map((ball) => ({ ball, label: ballLabel(ball, matchType) }));
    const font = (l: string) => f(900, l.length > 2 ? d * 0.44 : d * 0.62);
    const chipW = (l: string) => {
      ctx.font = font(l);
      return Math.max(d, ctx.measureText(l).width + 10);
    };
    const empties = Math.max(0, 6 - (s.ball ?? 0));
    const left = b.x + labelW;
    const right = b.x + b.w - (wide ? 18 : 8);
    const width = (i: number) => chips.slice(i).reduce((n, c) => n + chipW(c.label) + gap, 0) + empties * (d + gap) - gap;
    let from = 0;
    while (from < chips.length - 1 && left + width(from) > right) from++;
    let x = wide ? left : Math.max(left, b.x + (b.w - width(from)) / 2);
    for (const { ball, label } of chips.slice(from)) {
      const w = chipW(label);
      const [fill, color] = ballStyle(ball);
      ctx.fillStyle = fill;
      rr(ctx, x, cy - d / 2, w, d, d / 2);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.font = font(label);
      ctx.textAlign = 'center';
      ctx.fillText(label, x + w / 2, cy + 1);
      x += w + gap;
    }
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,.3)';
    for (let i = 0; i < empties && x + d <= right + 2; i++) {
      ctx.beginPath();
      ctx.arc(x + d / 2, cy, d / 2 - 1, 0, Math.PI * 2);
      ctx.stroke();
      x += d + gap;
    }
    ctx.restore();
  }

  // Team-coloured panel with a light top edge, like a broadcast graphic
  private glossy(b: Box, col: [string, string]) {
    const { ctx } = this;
    ctx.fillStyle = vGrad(ctx, b.y, b.h, col[0], col[1]);
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = 'rgba(255,255,255,.14)';
    ctx.fillRect(b.x, b.y, b.w, b.h * 0.45);
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.fillRect(b.x, b.y + b.h / 2 - 0.5, b.w, 1);
  }

  // ── Innings break / result card ─────────────────────────────────
  private drawCard(s: LiveScore) {
    const { ctx, W, H } = this;
    const w = Math.min(640, W - 40);
    const x = (W - w) / 2;
    const headH = 42;
    const bodyH = 154;
    const footH = 58;
    const y = (H - headH - bodyH - footH) / 2;
    const bat = PALETTE[colorIdx(s.battingTeam)];
    const final = s.inningsNum === 2;

    ctx.save();
    shadow(ctx, 0.6, 60, 24);
    ctx.fillStyle = C.panel;
    ctx.fillRect(x, y + headH, w, bodyH + footH);
    ctx.restore();

    const hw = w * 0.7;
    const hx = (W - hw) / 2;
    ctx.fillStyle = C.gold;
    ctx.beginPath();
    ctx.moveTo(hx + 14, y);
    ctx.lineTo(hx + hw - 14, y);
    ctx.lineTo(hx + hw, y + headH);
    ctx.lineTo(hx, y + headH);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1A1300';
    ctx.font = f(900, 22);
    spacing(ctx, 5);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(final ? 'RESULT' : 'INNINGS BREAK', W / 2 + 2, y + headH / 2 + 1);
    spacing(ctx, 0);

    const by = y + headH;
    const g = ctx.createLinearGradient(x, by, x + w, by + bodyH);
    g.addColorStop(0, bat[0]);
    g.addColorStop(0.45, bat[1]);
    g.addColorStop(1, C.panel);
    ctx.fillStyle = g;
    ctx.fillRect(x, by, w, bodyH);
    ctx.fillStyle = C.gold;
    ctx.fillRect(x, by, w, 3);

    const bcx = x + 30 + 46;
    const bcy = by + bodyH / 2;
    ctx.beginPath();
    ctx.arc(bcx, bcy, 50, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.4)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(bcx, bcy, 46, 0, Math.PI * 2);
    ctx.fillStyle = '#F1F5FF';
    ctx.fill();
    ctx.fillStyle = bat[1];
    ctx.font = f(900, 30);
    ctx.fillText(abbr(s.battingTeam), bcx, bcy + 1);

    const tx = bcx + 46 + 22;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.font = f(700, 22);
    spacing(ctx, 2);
    ctx.fillText(truncate(ctx, (s.battingTeam ?? '').toUpperCase(), x + w - 24 - tx), tx, by + 58);
    spacing(ctx, 0);
    ctx.fillStyle = '#fff';
    ctx.font = f(900, 72);
    const sc = `${s.runs ?? 0}/${s.wickets ?? 0}`;
    ctx.fillText(sc, tx, by + 124);
    const scW = ctx.measureText(sc).width;
    ctx.font = f(700, 26);
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.fillText(`(${s.over ?? 0}.${s.ball ?? 0} ov)`, tx + scW + 12, by + 124);

    const fy = by + bodyH;
    ctx.fillStyle = C.ink;
    ctx.fillRect(x, fy, w, footH);
    const runs = s.runs ?? 0;
    const parts: [string, boolean][] = final
      ? [[s.result || 'Match complete', !!s.result]]
      : [[`${s.bowlingTeam ?? ''} need `, false], [plural(runs + 1, 'run'), true], [` to win${s.overs ? ` from ${s.overs} overs` : ''}`, false]];
    let size = 26;
    const measure = () =>
      parts.reduce((n, [t]) => {
        ctx.font = f(800, size);
        return n + ctx.measureText(t.toUpperCase()).width;
      }, 0);
    while (measure() > w - 40 && size > 14) size--;
    let px = W / 2 - measure() / 2;
    ctx.textBaseline = 'middle';
    for (const [t, em] of parts) {
      ctx.font = f(800, size);
      ctx.fillStyle = em ? C.gold : '#fff';
      ctx.fillText(t.toUpperCase(), px, fy + footH / 2 + 1);
      px += ctx.measureText(t.toUpperCase()).width;
    }
  }

  // ── Replay badge (top right): REPLAY [SLOW-MO 0.5×] + progress ──
  private drawReplayTag(r: ReplaySource, now: number) {
    const { ctx, W } = this;
    const m = this.portrait ? 20 : 26;
    const h = 48;
    const y = m;
    const slow = r.rate < 1;
    ctx.save();
    ctx.font = f(900, 30, true);
    spacing(ctx, 3);
    const tw = ctx.measureText('REPLAY').width;
    spacing(ctx, 0);
    const slowText = `SLOW-MO ${+r.rate.toFixed(2)}×`;
    ctx.font = f(900, 18);
    spacing(ctx, 1.5);
    const sw = slow ? ctx.measureText(slowText).width + 24 : 0;
    spacing(ctx, 0);
    const mainW = tw + 76;
    const w = mainW + (slow ? sw + 6 : 0);
    const x = W - m - w;

    shadow(ctx, 0.5, 18, 6);
    ctx.fillStyle = vGrad(ctx, y, h, '#F43F4E', '#B5121F');
    rr(ctx, x, y, mainW, h, 8);
    ctx.fill();
    noShadow(ctx);
    // rewind icon, blinking gently
    ctx.globalAlpha = 0.75 + 0.25 * Math.sin(now / 180);
    ctx.fillStyle = '#fff';
    for (const dx of [0, 13]) {
      ctx.beginPath();
      ctx.moveTo(x + 16 + dx, y + h / 2);
      ctx.lineTo(x + 29 + dx, y + h / 2 - 10);
      ctx.lineTo(x + 29 + dx, y + h / 2 + 10);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.font = f(900, 30, true);
    spacing(ctx, 3);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('REPLAY', x + 54, y + h / 2 + 1);
    spacing(ctx, 0);
    if (slow) {
      const sx = x + mainW + 6;
      ctx.fillStyle = C.gold;
      rr(ctx, sx, y + 6, sw, h - 12, 6);
      ctx.fill();
      ctx.fillStyle = '#1A1300';
      ctx.font = f(900, 18);
      spacing(ctx, 1.5);
      ctx.fillText(slowText, sx + 12, y + h / 2 + 1);
      spacing(ctx, 0);
    }
    // progress
    const py = y + h + 6;
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    rr(ctx, x, py, w, 6, 3);
    ctx.fill();
    ctx.fillStyle = C.gold;
    rr(ctx, x, py, Math.max(6, w * Math.min(1, r.progress())), 6, 3);
    ctx.fill();
    ctx.restore();
  }

  // Diagonal gold/navy wipe in and out of a replay, like a TV sting
  private drawSting(p: number) {
    const { ctx, W, H } = this;
    const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
    const span = W + 700 + H * 0.35;
    const x = -700 + e * span * 1.2;
    ctx.save();
    ctx.translate(x, 0);
    ctx.transform(1, 0, -0.35, 1, 0, 0);
    ctx.fillStyle = C.gold;
    ctx.fillRect(0, -40, 120, H + 80);
    ctx.fillStyle = C.panel;
    ctx.fillRect(120, -40, 380, H + 80);
    ctx.fillStyle = C.red;
    ctx.fillRect(500, -40, 30, H + 80);
    ctx.restore();
    ctx.save();
    ctx.translate(x + 120 + 190 - H * 0.175, H / 2);
    ctx.fillStyle = '#fff';
    ctx.font = f(900, 64, true);
    spacing(ctx, 6);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.rotate(-Math.PI / 2 + 0.33);
    ctx.fillText('REPLAY', 0, 0);
    ctx.restore();
    spacing(ctx, 0);
  }

  // ── FOUR / SIX / WICKET / milestone banner ─────────────────────
  private drawBanner(now: number) {
    let b = this.banners[0];
    if (!b) return;
    if (!b.start) b.start = now;
    if (now - b.start > BANNER_MS + 100) {
      this.banners.shift();
      b = this.banners[0];
      if (!b) return;
      b.start = now;
    }
    const { ctx, W, H } = this;
    const t = now - b.start;
    const p = t / BANNER_MS;
    const [c0, c1, c2] = BANNER_STYLE[b.kind];
    const portrait = this.portrait;
    const bandH = portrait ? 120 : 130;
    const top = portrait ? H * 0.36 : H * 0.28 + 30;
    const skew = Math.tan((-4 * Math.PI) / 180);

    // Wipe in from the left, out to the right
    const vis0 = p < 0.86 ? 0 : (p - 0.86) / 0.14;
    const vis1 = p < 0.12 ? p / 0.12 : 1;
    const bx0 = -64 + vis0 * (W + 128);
    const bx1 = -64 + ease(vis1) * (W + 128);
    if (bx1 > bx0) {
      ctx.save();
      ctx.transform(1, skew, 0, 1, 0, -skew * (W / 2));
      ctx.beginPath();
      ctx.rect(bx0, top, bx1 - bx0, bandH);
      ctx.clip();
      const g = ctx.createLinearGradient(0, 0, W, 0);
      g.addColorStop(0, c0);
      g.addColorStop(0.3, c1);
      g.addColorStop(0.5, c2);
      g.addColorStop(0.7, c1);
      g.addColorStop(1, c0);
      ctx.fillStyle = g;
      ctx.fillRect(-64, top, W + 128, bandH);
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      const off = ((t / 500) * 46) % 46;
      for (let x = -64 + off; x < W + 64; x += 46) ctx.fillRect(x, top, 3, bandH);
      if (t > 350 && t < 1450) {
        const sx = -260 + ((t - 350) / 1100) * (W + 520);
        const sg = ctx.createLinearGradient(sx, 0, sx + 220, 0);
        sg.addColorStop(0, 'rgba(255,255,255,0)');
        sg.addColorStop(0.5, 'rgba(255,255,255,.55)');
        sg.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = sg;
        ctx.fillRect(sx, top, 220, bandH);
      }
      ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.fillRect(-64, top, W + 128, 4);
      ctx.fillRect(-64, top + bandH - 4, W + 128, 4);
      ctx.restore();
    }

    // Big italic word
    const k = [
      [0, 0, -200, 1.6],
      [0.08, 0, -200, 1.6],
      [0.22, 1, 0, 1],
      [0.84, 1, 20, 1],
      [1, 0, 300, 1],
    ];
    let i = 0;
    while (i < k.length - 2 && p > k[i + 1][0]) i++;
    const [p0, o0, x0, s0] = k[i];
    const [p1, o1, x1, s1] = k[i + 1];
    const q = Math.min(1, Math.max(0, (p - p0) / (p1 - p0 || 1)));
    const op = o0 + (o1 - o0) * q;
    if (op > 0.01) {
      ctx.save();
      ctx.globalAlpha = op;
      ctx.transform(1, skew, 0, 1, 0, -skew * (W / 2));
      ctx.translate(W / 2 + x0 + (x1 - x0) * q, top + bandH / 2 + 6);
      const sc = s0 + (s1 - s0) * q;
      ctx.scale(sc, sc);
      let size = b.kind === 'm' ? 112 : 132;
      if (portrait) size = b.kind === 'm' ? 92 : 112;
      ctx.font = f(900, size, true);
      spacing(ctx, 10);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(0,0,0,.25)';
      ctx.fillText(b.title, 0, 6);
      ctx.shadowColor = 'rgba(255,255,255,.45)';
      ctx.shadowBlur = 40;
      ctx.fillStyle = b.kind === 'm' ? '#2A1800' : '#fff';
      ctx.fillText(b.title, 0, 0);
      spacing(ctx, 0);
      ctx.restore();
    }

    for (const sp of b.sparks) {
      const st = (t - sp.delay) / 1600;
      if (st <= 0 || st >= 1) continue;
      const e = 1 - (1 - st) ** 3;
      ctx.save();
      ctx.globalAlpha = 1 - st;
      ctx.translate(W / 2 + Math.cos(sp.a) * sp.d * e, top + 65 + Math.sin(sp.a) * sp.d * 0.55 * e);
      ctx.rotate(sp.r * st);
      ctx.fillStyle = sp.color;
      ctx.fillRect(-5, -5, 10, 10);
      ctx.restore();
    }

    // Caption (latest commentary or the batter for a milestone)
    if (b.sub) {
      const so = p < 0.18 ? 0 : p < 0.28 ? (p - 0.18) / 0.1 : p < 0.86 ? 1 : 1 - (p - 0.86) / 0.14;
      if (so > 0.01) {
        ctx.save();
        ctx.globalAlpha = so;
        ctx.font = f(700, 24);
        spacing(ctx, 0.5);
        const text = truncate(ctx, b.sub, Math.min(868, W - 100));
        const tw = ctx.measureText(text).width + 52;
        const cy = top + bandH + 42 + (1 - Math.min(1, so)) * 20;
        ctx.fillStyle = C.ink;
        ctx.fillRect(W / 2 - tw / 2, cy, tw, 44);
        ctx.fillStyle = C.gold;
        ctx.fillRect(W / 2 - tw / 2, cy, 5, 44);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, W / 2 + 2, cy + 23);
        spacing(ctx, 0);
        ctx.restore();
      }
    }
  }
}

// ── Drawing helpers ────────────────────────────────────────────────
const f = (weight: number, size: number, italic = false) => `${italic ? 'italic ' : ''}${weight} ${Math.round(size)}px ${FONT}`;

// Broadcast font for the scoreboard; falls back to Arial Narrow until (or unless) it loads
let fontRequested = false;
function loadFont() {
  if (fontRequested || typeof document === 'undefined') return;
  fontRequested = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = FONT_URL;
  link.onload = () => {
    for (const w of ['600', '700', '800', '900', 'italic 800', 'italic 900']) document.fonts.load(`${w} 20px "Barlow Condensed"`).catch(() => {});
  };
  document.head.appendChild(link);
}

// Fit the whole frame (letterbox/pillarbox rather than crop)
function drawFit(ctx: CanvasRenderingContext2D, v: HTMLVideoElement, W: number, H: number) {
  const scale = Math.min(W / v.videoWidth, H / v.videoHeight);
  const w = v.videoWidth * scale;
  const h = v.videoHeight * scale;
  ctx.drawImage(v, (W - w) / 2, (H - h) / 2, w, h);
}

function spacing(ctx: CanvasRenderingContext2D, px: number) {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in c) c.letterSpacing = `${px}px`;
}

function shadow(ctx: CanvasRenderingContext2D, a: number, blur: number, y: number) {
  ctx.shadowColor = `rgba(0,0,0,${a})`;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetY = y;
}

function noShadow(ctx: CanvasRenderingContext2D) {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number | number[]) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function hGrad(ctx: CanvasRenderingContext2D, x: number, w: number, ...stops: string[]) {
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  return g;
}

function vGrad(ctx: CanvasRenderingContext2D, y: number, h: number, a: string, b: string) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  return g;
}

const ease = (x: number) => 1 - (1 - x) ** 3;

function ballIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.beginPath();
  ctx.arc(cx, cy, 8, 0, Math.PI * 2);
  ctx.fillStyle = C.red;
  ctx.fill();
  ctx.save();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.3;
  ctx.setLineDash([1.6, 1.4]);
  ctx.beginPath();
  ctx.arc(cx - 9, cy, 7, -0.8, 0.8);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx + 9, cy, 7, Math.PI - 0.8, Math.PI + 0.8);
  ctx.stroke();
  ctx.restore();
}

// Small cricket bat marking the striker
function batIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = '#fff';
  rr(ctx, -size * 0.16, -size * 0.12, size * 0.32, size * 0.62, size * 0.08);
  ctx.fill();
  ctx.fillRect(-size * 0.05, -size * 0.5, size * 0.1, size * 0.4);
  ctx.restore();
}

function truncate(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (max <= 0) return '';
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}
