import type { LiveScore, ScoreBall } from '@/types/score';

// Draws the camera onto a canvas, with the live scoreboard on top. The canvas stream is what viewers
// receive and what gets recorded, so the overlay is "burned in" and the outgoing track never changes
// when the camera is flipped.

const W = 1280;
const H = 720;
const FPS = 30;

const ballLabel = (b: ScoreBall) => {
  if (b.wicket) return 'W';
  if (b.extra === 'wd') return b.runs > 1 ? `${b.runs - 1}wd` : 'wd';
  if (b.extra === 'nb') return b.runs > 1 ? `${b.runs - 1}nb` : 'nb';
  if (b.extra === 'lb') return `${b.runs}lb`;
  if (b.extra === 'b') return `${b.runs}b`;
  return String(b.runs);
};

export class Compositor {
  readonly canvas: HTMLCanvasElement;
  readonly stream: MediaStream;
  private ctx: CanvasRenderingContext2D;
  private video: HTMLVideoElement;
  private timer: ReturnType<typeof setInterval>;
  private cameraOn = true;
  private score: LiveScore | null = null;
  private flash: { text: string; color: string; until: number } | null = null;
  private lastDeliveries: number | null = null;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d')!;
    this.video = document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
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

  setScore(score: LiveScore | null) {
    const d = score?.deliveries;
    if (score && d != null && this.lastDeliveries != null && d > this.lastDeliveries && score.lastBall) {
      const b = score.lastBall;
      if (b.wicket) this.flash = { text: 'WICKET!', color: '#dc2626', until: Date.now() + 3000 };
      else if (!b.extra && b.runs === 6) this.flash = { text: 'SIX!', color: '#7c3aed', until: Date.now() + 3000 };
      else if (!b.extra && b.runs === 4) this.flash = { text: 'FOUR!', color: '#2563eb', until: Date.now() + 3000 };
    }
    if (d != null) this.lastDeliveries = d;
    this.score = score;
  }

  destroy() {
    clearInterval(this.timer);
    this.stream.getTracks().forEach((t) => t.stop());
    this.video.srcObject = null;
  }

  private draw() {
    const { ctx, video } = this;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    if (this.cameraOn && video.videoWidth) {
      // Fit the whole frame (portrait phones get side bars rather than a crop)
      const scale = Math.min(W / video.videoWidth, H / video.videoHeight);
      const w = video.videoWidth * scale;
      const h = video.videoHeight * scale;
      ctx.drawImage(video, (W - w) / 2, (H - h) / 2, w, h);
    } else if (!this.cameraOn) {
      ctx.fillStyle = '#18181b';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#a1a1aa';
      ctx.font = '600 36px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Camera paused', W / 2, H / 2);
    }

    if (this.score && this.score.phase !== 'waiting') this.drawScore(this.score);
    if (this.flash && Date.now() < this.flash.until) this.drawFlash(this.flash);
  }

  private drawScore(s: LiveScore) {
    const { ctx } = this;
    const barH = 92;
    const y = H - barH - 24;
    const x = 24;
    const w = W - 48;

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    roundRect(ctx, x, y, w, barH, 14, 'rgba(11, 23, 48, 0.88)');

    // Team + score block
    const teamW = 300;
    roundRect(ctx, x, y, teamW, barH, 14, '#dc2626');
    ctx.fillStyle = '#fff';
    ctx.font = '700 22px system-ui, sans-serif';
    ctx.fillText(truncate(ctx, (s.battingTeam || '').toUpperCase(), teamW - 32), x + 16, y + 26);
    ctx.font = '900 40px system-ui, sans-serif';
    const scoreText = `${s.runs ?? 0}/${s.wickets ?? 0}`;
    ctx.fillText(scoreText, x + 16, y + 62);
    const scoreW = ctx.measureText(scoreText).width;
    ctx.font = '600 22px system-ui, sans-serif';
    ctx.fillStyle = '#fee2e2';
    ctx.fillText(`${s.over ?? 0}.${s.ball ?? 0}${s.overs ? ` / ${s.overs}` : ''} ov`, x + 28 + scoreW, y + 64);

    let cx = x + teamW + 24;
    ctx.fillStyle = '#fff';
    if (s.phase === 'innings_end') {
      ctx.font = '800 26px system-ui, sans-serif';
      const msg = s.result || (s.inningsNum === 1 ? 'Innings break' : 'Innings complete');
      ctx.fillText(truncate(ctx, msg, w - teamW - 48), cx, y + barH / 2);
      return;
    }

    // Batters
    const batW = 360;
    ctx.font = '700 22px system-ui, sans-serif';
    if (s.striker) ctx.fillText(truncate(ctx, `${s.striker.name}*  ${s.striker.runs} (${s.striker.balls})`, batW), cx, y + 28);
    ctx.font = '500 22px system-ui, sans-serif';
    ctx.fillStyle = '#cbd5e1';
    if (s.nonStriker) ctx.fillText(truncate(ctx, `${s.nonStriker.name}  ${s.nonStriker.runs} (${s.nonStriker.balls})`, batW), cx, y + 64);
    cx += batW + 20;

    // Bowler + this over
    ctx.fillStyle = '#fff';
    ctx.font = '600 22px system-ui, sans-serif';
    if (s.bowler) {
      const b = s.bowler;
      ctx.fillText(truncate(ctx, `${b.name}  ${b.wickets}-${b.runs} (${b.overs}.${b.balls})`, 300), cx, y + 28);
    }
    let bx = cx;
    for (const ball of (s.thisOver ?? []).slice(-8)) {
      const label = ballLabel(ball);
      const isBoundary = !ball.extra && (ball.runs === 4 || ball.runs === 6);
      const color = ball.wicket ? '#dc2626' : isBoundary ? (ball.runs === 6 ? '#7c3aed' : '#2563eb') : 'rgba(255,255,255,0.18)';
      ctx.font = '800 16px system-ui, sans-serif';
      const bw = Math.max(32, ctx.measureText(label).width + 16);
      roundRect(ctx, bx, y + 50, bw, 28, 14, color);
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center';
      ctx.fillText(label, bx + bw / 2, y + 64);
      ctx.textAlign = 'left';
      bx += bw + 6;
    }

    // Run rate / chase
    const totalBalls = (s.over ?? 0) * 6 + (s.ball ?? 0);
    ctx.textAlign = 'right';
    ctx.font = '700 20px system-ui, sans-serif';
    if (s.target && s.overs) {
      const need = Math.max(0, s.target - (s.runs ?? 0));
      const left = Math.max(0, s.overs * 6 - totalBalls);
      ctx.fillStyle = '#facc15';
      ctx.fillText(`Need ${need} off ${left}`, x + w - 18, y + 28);
    }
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '600 18px system-ui, sans-serif';
    ctx.fillText(`CRR ${totalBalls ? (((s.runs ?? 0) / totalBalls) * 6).toFixed(2) : '0.00'}`, x + w - 18, y + 64);
    ctx.textAlign = 'left';
  }

  private drawFlash(f: { text: string; color: string }) {
    const { ctx } = this;
    ctx.font = '900 120px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(f.text).width;
    roundRect(ctx, W / 2 - tw / 2 - 40, H / 2 - 110, tw + 80, 170, 24, f.color);
    ctx.fillStyle = '#fff';
    ctx.fillText(f.text, W / 2, H / 2 - 22);
    ctx.textAlign = 'left';
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, fill: string) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
}

function truncate(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}
