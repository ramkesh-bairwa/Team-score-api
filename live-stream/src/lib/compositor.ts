import type { LiveScore, ScoreBall } from '@/types/score';

// Draws the camera onto a canvas, with the live scoreboard on top. The canvas stream is what viewers
// receive and what gets recorded, so the overlay is "burned in" and the outgoing track never changes
// when the camera is flipped or a replay is put on air.
// The look matches the CricScore browser-source overlay (server src/overlay.html).

const W = 1280;
const H = 720;
const FPS = 30;
const FONT = '"Barlow Condensed", "Arial Narrow", "Roboto Condensed", sans-serif';
const FONT_URL =
  'https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,600;0,700;0,800;0,900;1,900&display=swap';

const C = {
  ink: '#040916',
  panel: '#0A1430',
  gold: '#FFC531',
  gold2: '#F59E0B',
  red: '#EF233C',
  muted: '#8C9CC0',
  soft: '#C9D3EA',
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
    return (b.extra === 'wd' ? 'Wd' : 'Nb') + (taken > 0 ? `+${taken}` : '');
  }
  if (b.extra === 'lb') return `Lb${b.runs}`;
  if (b.extra === 'b') return `B${b.runs}`;
  return b.runs === 0 ? '•' : String(b.runs);
};

const ballColors = (b: ScoreBall): [string, string] | null => {
  if (b.wicket) return ['#FF4D5E', C.red];
  if (b.extra === 'db') return ['#475569', '#475569'];
  if (b.extra) return ['#FB923C', C.extra];
  if (b.runs === 6) return ['#A855F7', C.six];
  if (b.runs === 4) return ['#3B82F6', C.four];
  return null;
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
  frame(): HTMLVideoElement | null;
  progress(): number; // 0..1
  rate: number;
}

const STING_MS = 650;

export class Compositor {
  readonly canvas: HTMLCanvasElement;
  readonly stream: MediaStream;
  private ctx: CanvasRenderingContext2D;
  private video: HTMLVideoElement;
  private timer: ReturnType<typeof setInterval>;
  private cameraOn = true;
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

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d')!;
    this.hold = document.createElement('canvas');
    this.hold.width = W;
    this.hold.height = H;
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    loadFont();
    this.draw();
    this.stream = this.canvas.captureStream(FPS);
    // setInterval keeps drawing (slowly) even when the tab isn't focused; rAF would stop entirely
    this.timer = setInterval(() => this.draw(), 1000 / FPS);
  }

  setSource(stream: MediaStream) {
    this.video.srcObject = stream;
    this.video.play().catch(() => {});
  }

  setCameraOn(on: boolean) {
    this.cameraOn = on;
  }

  setReplay(replay: ReplaySource | null) {
    if (!!replay !== !!this.replay) this.sting = Date.now();
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

  private draw() {
    const { ctx } = this;
    const now = Date.now();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    if (this.replay) {
      const v = this.replay.frame();
      if (v && v.videoWidth && v.readyState >= 2) {
        drawFit(ctx, v);
        this.hold.getContext('2d')!.drawImage(this.canvas, 0, 0);
      } else {
        ctx.drawImage(this.hold, 0, 0);
      }
    } else if (this.cameraOn && this.video.videoWidth) {
      drawFit(ctx, this.video);
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
    if (s && s.phase !== 'waiting') {
      this.drawBug(s);
      if (s.phase === 'innings_end') this.drawCard(s);
      else this.drawBoard(s, now);
    }
    if (this.replay) this.drawReplayTag(this.replay);
    this.drawBanner(now);
    if (now - this.sting < STING_MS) this.drawSting((now - this.sting) / STING_MS);
  }

  // ── Top-left match bug ──────────────────────────────────────────
  private drawBug(s: LiveScore) {
    const { ctx } = this;
    const y = 22;
    const h = 34;
    let x = 24;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 6;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    ctx.font = f(900, 18);
    spacing(ctx, 2);
    const liveW = ctx.measureText('LIVE').width + 44;
    para(ctx, x, y, liveW, h, 0, 10, C.red);
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x + 16, y + h / 2, 4.5, 0, Math.PI * 2);
    ctx.globalAlpha = Date.now() % 1200 < 600 ? 1 : 0.25;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillText('LIVE', x + 26, y + h / 2 + 1);
    x += liveW - 10;

    const bat = abbr(s.battingTeam);
    const vs = ` v ${abbr(s.bowlingTeam)}`;
    ctx.font = f(800, 19);
    spacing(ctx, 1);
    const titleW = ctx.measureText(bat + vs).width + 44;
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    para(ctx, x, y, titleW, h, 10, 10, C.panel);
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = C.gold;
    ctx.fillText(bat, x + 22, y + h / 2 + 1);
    ctx.fillStyle = '#fff';
    ctx.fillText(vs, x + 22 + ctx.measureText(bat).width, y + h / 2 + 1);
    x += titleW - 10;

    const inn = `${s.inningsNum === 2 ? '2ND' : '1ST'} INNINGS${s.overs ? ` · ${s.overs} OVERS` : ''}`;
    ctx.font = f(700, 15);
    spacing(ctx, 1.5);
    const innW = ctx.measureText(inn).width + 40;
    para(ctx, x, y, innW, h, 10, 10, hGrad(ctx, x, innW, '#13224D', '#1A2B5C'));
    ctx.fillStyle = C.soft;
    ctx.fillText(inn, x + 20, y + h / 2 + 1);
    spacing(ctx, 0);
    ctx.restore();
  }

  // ── Bottom scoreboard: batters | raised score hub | bowler + this over ──
  private drawBoard(s: LiveScore, now: number) {
    const { ctx } = this;
    const L = 30;
    const R = W - 30;
    const infoY = 668;
    const infoH = 34;
    const wingY = 590;
    const wingH = 78;
    const hubW = 330;
    const hubX = (W - hubW) / 2;
    const hubY = 556;
    const hubH = infoY - hubY;
    const bat = PALETTE[colorIdx(s.battingTeam)];
    let bowlIdx = colorIdx(s.bowlingTeam);
    if (bowlIdx === colorIdx(s.battingTeam)) bowlIdx = (bowlIdx + 1) % PALETTE.length;
    const bowl = PALETTE[bowlIdx];
    const matchType = s.matchType || 'local';

    ctx.save();
    // Shadow under the whole board
    ctx.shadowColor = 'rgba(0,0,0,.6)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 12;
    ctx.fillStyle = C.panel;
    rr(ctx, L, wingY, R - L, infoY + infoH - wingY, [12, 12, 10, 10]);
    ctx.fill();
    ctx.restore();

    // Wings
    const wingGrad = () => {
      const g = ctx.createLinearGradient(0, wingY, 0, wingY + wingH);
      g.addColorStop(0, '#1C2C62');
      g.addColorStop(0.52, C.panel);
      g.addColorStop(1, '#060E24');
      return g;
    };
    const lw = hubX + 14 - L;
    const rx = hubX + hubW - 14;
    ctx.fillStyle = wingGrad();
    rr(ctx, L, wingY, lw, wingH, [12, 0, 0, 0]);
    ctx.fill();
    rr(ctx, rx, wingY, R - rx, wingH, [0, 12, 0, 0]);
    ctx.fill();
    gloss(ctx, L, wingY, R - L, wingH * 0.46, 0.08);
    ctx.fillStyle = hGrad(ctx, L, lw, 'rgba(0,0,0,0)', bat[0]);
    ctx.fillRect(L + 10, wingY, lw - 10, 3);
    ctx.fillStyle = hGrad(ctx, rx, R - rx, bowl[0], 'rgba(0,0,0,0)');
    ctx.fillRect(rx, wingY, R - rx - 10, 3);

    // Batters
    const rowL = L + 18;
    const rowR = hubX + 14 - 34;
    this.drawBatter(s.striker ?? null, true, rowL, rowR, 612);
    this.drawBatter(s.nonStriker ?? null, false, rowL, rowR, 646);

    // Bowler + this over
    const bl = rx + 34;
    const br = R - 18;
    ctx.textBaseline = 'middle';
    if (s.bowler) {
      const b = s.bowler;
      ballIcon(ctx, bl + 10, 612);
      const balls = `(${b.overs}.${b.balls})`;
      const fig = `${b.wickets}-${b.runs}`;
      ctx.textAlign = 'right';
      ctx.font = f(600, 16);
      ctx.fillStyle = C.muted;
      ctx.fillText(balls, br, 614);
      const ballsW = ctx.measureText(balls).width;
      ctx.font = f(900, 24);
      ctx.fillStyle = '#fff';
      ctx.fillText(fig, br - ballsW - 3, 612);
      const figW = ctx.measureText(fig).width;
      ctx.textAlign = 'left';
      ctx.font = f(700, 21);
      spacing(ctx, 0.4);
      ctx.fillText(truncate(ctx, b.name.toUpperCase(), br - ballsW - figW - 16 - (bl + 24)), bl + 24, 613);
      spacing(ctx, 0);
    }
    ctx.font = f(800, 12);
    spacing(ctx, 1.5);
    ctx.fillStyle = C.muted;
    ctx.textAlign = 'right';
    ctx.fillText('THIS', bl + 30, 640);
    ctx.fillText('OVER', bl + 30, 653);
    spacing(ctx, 0);
    let cx = bl + 38;
    const balls = s.thisOver ?? [];
    const empties = Math.max(0, 6 - (s.ball ?? 0));
    const chipW = (label: string) => {
      ctx.font = f(900, label.length > 2 ? 13 : 15);
      return Math.max(28, ctx.measureText(label).width + 12);
    };
    // Keep the most recent balls if a long over doesn't fit
    let shown = balls.map((b) => ballLabel(b, matchType));
    let start = 0;
    const widthOf = (from: number) =>
      shown.slice(from).reduce((n, l) => n + chipW(l) + 6, 0) + empties * 34;
    while (start < shown.length - 1 && cx + widthOf(start) > br) start++;
    shown = shown.slice(start);
    shown.forEach((label, i) => {
      const b = balls[start + i];
      const w = chipW(label);
      const col = ballColors(b);
      ctx.fillStyle = col ? vGrad(ctx, 632, 28, col[0], col[1]) : 'rgba(255,255,255,.12)';
      rr(ctx, cx, 632, w, 28, 14);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,.22)';
      ctx.fillRect(cx + 6, 657, w - 12, 3);
      ctx.fillStyle = !col && b.runs === 0 ? C.muted : b.extra === 'db' ? '#CBD5E1' : '#fff';
      ctx.font = f(900, label.length > 2 ? 13 : 15);
      ctx.textAlign = 'center';
      ctx.fillText(label, cx + w / 2, 647);
      cx += w + 6;
    });
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255,255,255,.18)';
    for (let i = 0; i < empties && cx + 28 <= br + 2; i++) {
      ctx.beginPath();
      ctx.arc(cx + 14, 646, 13, 0, Math.PI * 2);
      ctx.stroke();
      cx += 34;
    }
    ctx.restore();

    // Info strip
    const ig = ctx.createLinearGradient(L, 0, R, 0);
    ig.addColorStop(0, '#03070F');
    ig.addColorStop(0.5, '#0B1638');
    ig.addColorStop(1, '#03070F');
    ctx.fillStyle = ig;
    rr(ctx, L, infoY, R - L, infoH, [0, 0, 10, 10]);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,197,49,.35)';
    ctx.fillRect(L, infoY, R - L, 1);

    const totalBalls = (s.over ?? 0) * 6 + (s.ball ?? 0);
    const maxBalls = (s.overs ?? 0) * 6;
    const runs = s.runs ?? 0;
    const crr = totalBalls ? ((runs / totalBalls) * 6).toFixed(2) : '0.00';
    const left: [string, string, boolean][] = [];
    const right: [string, string, boolean][] = [];
    let status: [string, boolean][];
    if (s.target) {
      const need = Math.max(0, s.target - runs);
      const ballsLeft = Math.max(0, maxBalls - totalBalls);
      status =
        need === 0
          ? [[`${s.battingTeam} have reached the target!`, false]]
          : [['NEED ', false], [plural(need, 'RUN'), true], [' FROM ', false], [plural(ballsLeft, 'BALL'), true]];
      left.push(['TARGET', String(s.target), true], ['CRR', crr, false]);
      if (ballsLeft && need) right.push(['RRR', ((need / ballsLeft) * 6).toFixed(2), false]);
      right.push(['BALLS LEFT', String(ballsLeft), false]);
    } else {
      const proj = totalBalls && maxBalls ? Math.round((runs / totalBalls) * maxBalls) : 0;
      status = [[`${s.battingTeam ?? ''}  v  ${s.bowlingTeam ?? ''}`.toUpperCase(), false]];
      left.push(['CRR', crr, true]);
      if (proj) right.push(['PROJECTED', String(proj), false]);
    }
    let lx = L;
    for (const st of left) lx = this.drawStat(st, lx, infoY, infoH, 'l', [L, R]);
    let rx2 = R;
    for (const st of [...right].reverse()) rx2 = this.drawStat(st, rx2, infoY, infoH, 'r', [L, R]);
    this.drawStatus(status, lx + 12, rx2 - 12, infoY + infoH / 2 + 1);

    // Centre hub (drawn last so it sits over the wings)
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.35)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = -6;
    const hg = ctx.createRadialGradient(hubX + 66, hubY, 0, hubX + 66, hubY, 420);
    hg.addColorStop(0, bat[0]);
    hg.addColorStop(0.62, bat[1]);
    hg.addColorStop(1, '#050B1F');
    ctx.fillStyle = hg;
    rr(ctx, hubX, hubY, hubW, hubH, [16, 16, 0, 0]);
    ctx.fill();
    ctx.restore();
    ctx.save();
    rr(ctx, hubX, hubY, hubW, hubH, [16, 16, 0, 0]);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,.1)';
    ctx.lineWidth = 2;
    for (let x = hubX - hubH; x < hubX + hubW; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x, hubY + hubH);
      ctx.lineTo(x + hubH * 0.47, hubY);
      ctx.stroke();
    }
    // periodic shine
    const t = (now % 7000) / 7000;
    if (t > 0.7) {
      const sx = hubX - 120 + ((t - 0.7) / 0.3) * (hubW + 240);
      const sg = ctx.createLinearGradient(sx, 0, sx + 90, 0);
      sg.addColorStop(0, 'rgba(255,255,255,0)');
      sg.addColorStop(0.5, 'rgba(255,255,255,.28)');
      sg.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(sx, hubY, 90, hubH);
    }
    ctx.fillStyle = hGrad(ctx, hubX, hubW, C.gold2, C.gold, C.gold2);
    ctx.fillRect(hubX, hubY, hubW, 4);
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,.16)';
    ctx.lineWidth = 2;
    rr(ctx, hubX + 1, hubY + 1, hubW - 2, hubH - 1, [15, 15, 0, 0]);
    ctx.stroke();

    // Badge
    const bcx = hubX + 16 + 32;
    const bcy = hubY + 56;
    ctx.beginPath();
    ctx.arc(bcx, bcy, 38, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,.18)';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(bcx, bcy, 35, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.4)';
    ctx.fill();
    const bg = ctx.createRadialGradient(bcx - 11, bcy - 13, 2, bcx, bcy, 34);
    bg.addColorStop(0, '#fff');
    bg.addColorStop(0.7, '#D5DDEF');
    ctx.beginPath();
    ctx.arc(bcx, bcy, 32, 0, Math.PI * 2);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.fillStyle = bat[1];
    ctx.font = f(900, abbr(s.battingTeam).length > 3 ? 18 : 21);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(abbr(s.battingTeam), bcx, bcy + 1);

    // Team + score + overs
    const ix = hubX + 16 + 64 + 14;
    const ovW = 68;
    const ovX = hubX + hubW - 18 - ovW;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = f(900, 22);
    spacing(ctx, 1.5);
    ctx.fillStyle = '#fff';
    const team = abbr(s.battingTeam);
    ctx.fillText(team, ix, hubY + 34);
    const tw = ctx.measureText(team).width;
    ctx.font = f(700, 15);
    spacing(ctx, 1);
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.fillText(`v ${abbr(s.bowlingTeam)}`, ix + tw + 6, hubY + 34);
    spacing(ctx, 0);

    const scoreText = `${runs}/${s.wickets ?? 0}`;
    const bt = now - this.bumpAt;
    const scale = bt < 550 ? 1 + 0.16 * Math.sin((Math.PI * bt) / 550) : 1;
    ctx.save();
    ctx.font = f(900, 60);
    const maxW = ovX - 8 - ix;
    const sw = ctx.measureText(scoreText).width;
    const fit = sw > maxW ? maxW / sw : 1;
    ctx.translate(ix, hubY + 94);
    ctx.scale(scale * fit, scale * fit);
    ctx.shadowColor = 'rgba(0,0,0,.4)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = bt < 300 ? C.gold : '#fff';
    ctx.fillText(scoreText, 0, 0);
    ctx.restore();

    ctx.fillStyle = 'rgba(0,0,0,.32)';
    rr(ctx, ovX, hubY + 34, ovW, 46, 6);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.12)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = f(900, 22);
    ctx.fillText(`${s.over ?? 0}.${s.ball ?? 0}`, ovX + ovW / 2, hubY + 59);
    ctx.font = f(800, 12);
    spacing(ctx, 1.5);
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.fillText(s.overs ? `OF ${s.overs} OV` : 'OVERS', ovX + ovW / 2, hubY + 74);
    spacing(ctx, 0);
    ctx.textAlign = 'left';
  }

  private drawBatter(p: { name: string; runs: number; balls: number } | null, onStrike: boolean, l: number, r: number, cy: number) {
    if (!p) return;
    const { ctx } = this;
    if (onStrike) {
      ctx.fillStyle = hGrad(ctx, l, (r - l) * 0.8, 'rgba(255,197,49,.18)', 'rgba(255,197,49,0)');
      rr(ctx, l, cy - 15, r - l, 30, 5);
      ctx.fill();
      ctx.fillStyle = C.gold;
      rr(ctx, l, cy - 11, 3, 22, 2);
      ctx.fill();
      batIcon(ctx, l + 16, cy);
    }
    ctx.textBaseline = 'middle';
    const balls = `(${p.balls})`;
    ctx.textAlign = 'right';
    ctx.font = f(600, 16);
    ctx.fillStyle = C.muted;
    ctx.fillText(balls, r - 10, cy + 2);
    const ballsW = ctx.measureText(balls).width;
    ctx.font = f(900, 24);
    ctx.fillStyle = onStrike ? C.gold : C.soft;
    ctx.fillText(String(p.runs), r - 10 - ballsW - 3, cy);
    const runsW = ctx.measureText(String(p.runs)).width;
    ctx.textAlign = 'left';
    ctx.font = f(700, 21);
    spacing(ctx, 0.4);
    ctx.fillStyle = onStrike ? '#fff' : C.soft;
    const nx = l + 32;
    ctx.fillText(truncate(ctx, p.name.toUpperCase(), r - 10 - ballsW - runsW - 14 - nx), nx, cy + 1);
    spacing(ctx, 0);
  }

  // One stat tab in the info strip; returns the x where the next tab starts
  private drawStat([k, v, hl]: [string, string, boolean], x: number, y: number, h: number, side: 'l' | 'r', [L, R]: [number, number]) {
    const { ctx } = this;
    ctx.font = f(800, 13);
    spacing(ctx, 1.5);
    const kw = ctx.measureText(k).width;
    spacing(ctx, 0);
    ctx.font = f(800, 18);
    const vw = ctx.measureText(v).width;
    const w = kw + vw + 7 + 32;
    const x0 = side === 'l' ? x : x - w;
    if (hl) {
      ctx.fillStyle = C.gold;
      rr(ctx, x0, y, w, h, [0, 0, x0 === R - w ? 10 : 0, x0 === L ? 10 : 0]);
      ctx.fill();
    } else {
      ctx.fillStyle = 'rgba(255,255,255,.08)';
      ctx.fillRect(side === 'l' ? x0 + w - 1 : x0, y + 1, 1, h - 1);
    }
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.font = f(800, 13);
    spacing(ctx, 1.5);
    ctx.fillStyle = hl ? 'rgba(26,19,0,.7)' : C.muted;
    ctx.fillText(k, x0 + 16, y + h / 2 + 1);
    spacing(ctx, 0);
    ctx.font = f(800, 18);
    ctx.fillStyle = hl ? '#1A1300' : '#fff';
    ctx.fillText(v, x0 + 16 + kw + 7, y + h / 2 + 1);
    return side === 'l' ? x0 + w : x0;
  }

  private drawStatus(parts: [string, boolean][], l: number, r: number, cy: number) {
    const { ctx } = this;
    let size = 19;
    const measure = () =>
      parts.reduce((n, [t, em]) => {
        ctx.font = f(em ? 900 : 800, size);
        return n + ctx.measureText(t.toUpperCase()).width;
      }, 0);
    spacing(ctx, 1);
    while (measure() > r - l && size > 12) size--;
    let x = (l + r) / 2 - measure() / 2;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (const [t, em] of parts) {
      const txt = t.toUpperCase();
      ctx.font = f(em ? 900 : 800, size);
      ctx.fillStyle = em ? C.gold : C.soft;
      ctx.fillText(txt, x, cy);
      x += ctx.measureText(txt).width;
    }
    spacing(ctx, 0);
  }

  // ── Innings break / result card ─────────────────────────────────
  private drawCard(s: LiveScore) {
    const { ctx } = this;
    const w = 640;
    const x = (W - w) / 2;
    const headH = 42;
    const bodyH = 154;
    const footH = 58;
    const y = (H - headH - bodyH - footH) / 2;
    const bat = PALETTE[colorIdx(s.battingTeam)];
    const final = s.inningsNum === 2;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.6)';
    ctx.shadowBlur = 60;
    ctx.shadowOffsetY = 24;
    ctx.fillStyle = C.panel;
    ctx.fillRect(x, y + headH, w, bodyH + footH);
    ctx.restore();

    // Head
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

    // Body
    const by = y + headH;
    const g = ctx.createLinearGradient(x, by, x + w, by + bodyH);
    g.addColorStop(0, bat[0]);
    g.addColorStop(0.45, bat[1]);
    g.addColorStop(1, C.panel);
    ctx.fillStyle = g;
    ctx.fillRect(x, by, w, bodyH);
    ctx.fillStyle = C.gold;
    ctx.fillRect(x, by, w, 3);

    const bcx = x + 34 + 46;
    const bcy = by + bodyH / 2;
    ctx.beginPath();
    ctx.arc(bcx, bcy, 50, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,.4)';
    ctx.fill();
    const bg = ctx.createRadialGradient(bcx - 15, bcy - 18, 2, bcx, bcy, 48);
    bg.addColorStop(0, '#fff');
    bg.addColorStop(0.7, '#D5DDEF');
    ctx.beginPath();
    ctx.arc(bcx, bcy, 46, 0, Math.PI * 2);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.fillStyle = bat[1];
    ctx.font = f(900, 30);
    ctx.fillText(abbr(s.battingTeam), bcx, bcy + 1);

    const tx = bcx + 46 + 24;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = 'rgba(255,255,255,.9)';
    ctx.font = f(700, 22);
    spacing(ctx, 2);
    ctx.fillText(truncate(ctx, (s.battingTeam ?? '').toUpperCase(), x + w - 30 - tx), tx, by + 58);
    spacing(ctx, 0);
    ctx.fillStyle = '#fff';
    ctx.font = f(900, 72);
    const sc = `${s.runs ?? 0}/${s.wickets ?? 0}`;
    ctx.fillText(sc, tx, by + 124);
    const scW = ctx.measureText(sc).width;
    ctx.font = f(700, 26);
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.fillText(`(${s.over ?? 0}.${s.ball ?? 0} ov)`, tx + scW + 12, by + 124);

    // Foot
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

  // ── Replay ──────────────────────────────────────────────────────
  private drawReplayTag(r: ReplaySource) {
    const { ctx } = this;
    const label = r.rate < 1 ? 'SLOW-MO REPLAY' : 'REPLAY';
    ctx.font = f(900, 22);
    spacing(ctx, 3);
    const w = ctx.measureText(label).width + 62;
    const x = W - 24 - w;
    const y = 22;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.45)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 6;
    para(ctx, x, y, w, 40, 12, 0, C.red);
    ctx.restore();
    // rewind icon
    ctx.fillStyle = '#fff';
    for (const dx of [0, 11]) {
      ctx.beginPath();
      ctx.moveTo(x + 22 + dx, y + 20);
      ctx.lineTo(x + 33 + dx, y + 12);
      ctx.lineTo(x + 33 + dx, y + 28);
      ctx.closePath();
      ctx.fill();
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, x + 50, y + 21);
    spacing(ctx, 0);
    ctx.fillStyle = 'rgba(255,255,255,.25)';
    ctx.fillRect(x + 12, y + 40, w - 12, 4);
    ctx.fillStyle = C.gold;
    ctx.fillRect(x + 12, y + 40, (w - 12) * Math.min(1, r.progress()), 4);
  }

  // Diagonal gold/navy wipe in and out of a replay, like a TV sting
  private drawSting(p: number) {
    const { ctx } = this;
    const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
    const span = W + 700;
    const x = -700 + e * span * 1.25;
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
    ctx.translate(x + 120 + 190 + H * 0.17, H / 2);
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
    const t = now - b.start;
    const p = t / BANNER_MS;
    const { ctx } = this;
    const [c0, c1, c2] = BANNER_STYLE[b.kind];
    const top = H * 0.28 + 30;
    const bandH = 130;
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
      // streaks
      ctx.fillStyle = 'rgba(255,255,255,.18)';
      const off = ((t / 500) * 46) % 46;
      for (let x = -64 + off; x < W + 64; x += 46) ctx.fillRect(x, top, 3, bandH);
      // shine
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
      ctx.font = f(900, b.kind === 'm' ? 112 : 132, true);
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

    // Sparks
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
        const text = truncate(ctx, b.sub, 868);
        const tw = ctx.measureText(text).width + 52;
        const cy = H * 0.28 + 172 + (1 - Math.min(1, so)) * 20;
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
const f = (weight: number, size: number, italic = false) => `${italic ? 'italic ' : ''}${weight} ${size}px ${FONT}`;

// Broadcast font for the scoreboard; falls back to Arial Narrow until (or unless) it loads
let fontRequested = false;
function loadFont() {
  if (fontRequested || typeof document === 'undefined') return;
  fontRequested = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = FONT_URL;
  link.onload = () => {
    for (const w of ['600', '700', '800', '900', 'italic 900']) document.fonts.load(`${w} 20px "Barlow Condensed"`).catch(() => {});
  };
  document.head.appendChild(link);
}

// Fit the whole frame (portrait phones get side bars rather than a crop)
function drawFit(ctx: CanvasRenderingContext2D, v: HTMLVideoElement) {
  const scale = Math.min(W / v.videoWidth, H / v.videoHeight);
  const w = v.videoWidth * scale;
  const h = v.videoHeight * scale;
  ctx.drawImage(v, (W - w) / 2, (H - h) / 2, w, h);
}

function spacing(ctx: CanvasRenderingContext2D, px: number) {
  const c = ctx as CanvasRenderingContext2D & { letterSpacing?: string };
  if ('letterSpacing' in c) c.letterSpacing = `${px}px`;
}

function rr(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number | number[]) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

// Parallelogram with slanted left/right edges (inset in px at the bottom-left / top-right)
function para(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, left: number, right: number, fill: string | CanvasGradient) {
  ctx.beginPath();
  ctx.moveTo(x + left, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w - right, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
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

function gloss(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, a: number) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, `rgba(255,255,255,${a})`);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

const ease = (x: number) => 1 - (1 - x) ** 3;

function batIcon(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = C.gold;
  rr(ctx, -3.5, -3, 7, 12, 2);
  ctx.fill();
  ctx.fillRect(-1.2, -9, 2.4, 7);
  ctx.restore();
}

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

function truncate(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (max <= 0) return '';
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}
