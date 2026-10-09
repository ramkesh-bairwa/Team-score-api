// Ball-by-ball commentary. Each boundary/wicket line is opener + action + closer, picked at random,
// so every category has well over 1,000 distinct lines (see COMMENTARY_VARIETY).
// Placeholders: {bat} batter, {bowl} bowler, {fld} fielder / catcher / keeper.

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
const fill = (s: string, v: { bat: string; bowl: string; fld?: string }) =>
  s.replace(/\{bat\}/g, v.bat).replace(/\{bowl\}/g, v.bowl).replace(/\{fld\}/g, v.fld || v.bowl);

const FOUR_OPEN = [
  'BOOM BOOM!', 'FOUR!', 'Cracking shot!', 'Shot!', 'What a stroke!', 'Dhamaka!', 'Glorious!', 'Beautiful!',
  'Pure timing!', 'That is a boundary!', 'Oh, that is lovely!', 'Bang!', 'Sublime!', 'Too good!', 'Classy!',
  'Whack!', 'Exquisite!', 'Brilliant!', 'Wow!', 'Kya shot hai!',
];
const FOUR_ACT = [
  '{bat} leans into the drive and pierces the covers', '{bat} rocks back and cuts {bowl} past point',
  '{bat} whips it off the pads through mid-wicket', '{bat} punches it straight down the ground',
  '{bat} flicks it fine past short leg', '{bat} slaps {bowl} through extra cover',
  '{bat} pulls hard in front of square', '{bat} guides it delicately past the keeper',
  '{bat} lofts it over mid-off and it bounces over the rope', '{bat} sweeps it hard behind square',
  '{bat} reverse-sweeps {bowl} to the fence', '{bat} uppercuts it over the slips',
  '{bat} drills it back past {bowl}', '{bat} times it off the back foot through the gap',
  '{bat} dances down and drives {bowl} on the up', '{bat} late-cuts it with soft hands',
  '{bat} opens the face and runs it to third man', '{bat} clips it neatly off the toes',
  '{bat} hammers a short ball through square leg', '{bat} carves it over point',
];
const FOUR_CLOSE = [
  'No chance for the fielder.', 'Races away to the boundary.', 'The ball beats the fielder easily.',
  'Four more to the total.', '{bowl} can only watch.', 'The crowd loves it!', 'Pressure on {bowl} now.',
  'Perfectly placed.', 'All timing, no power needed.', 'The fielder gave chase in vain.', 'Found the gap.',
  'Ek dum mast!', 'Runs are flowing now.', 'What placement!', 'The scoreboard ticks over nicely.',
];

const SIX_OPEN = [
  'BOOM BOOM!', 'SIX!', 'MAXIMUM!', 'Out of the park!', 'Huge!', 'That is gone all the way!', 'Monster hit!',
  'Dhamakedaar!', 'Bang!', 'Into the stands!', 'What a strike!', 'Clean as a whistle!', 'Massive!',
  'Sky high!', 'Chakka!', 'Wow!', 'Unbelievable!', 'Muscle power!', 'Launched!', 'Gone!',
];
const SIX_ACT = [
  '{bat} clears the front leg and smashes {bowl} over long-on', '{bat} steps out and lofts it straight over {bowl}',
  '{bat} pulls it miles over deep mid-wicket', '{bat} slog-sweeps it into the crowd',
  '{bat} picks the length early and deposits it over cow corner', '{bat} goes inside-out over extra cover',
  '{bat} hooks it over fine leg', '{bat} launches {bowl} into the second tier',
  '{bat} swings through the line and sends it sailing', '{bat} plays a helicopter shot over long-on',
  '{bat} reverse-hits it over third man', '{bat} heaves it high over square leg',
  '{bat} dances down the track and goes big', '{bat} flat-bats it over long-off',
  '{bat} scoops it over fine leg', '{bat} hits it on the up, clean over the bowler',
  '{bat} takes on the short ball and wins', '{bat} goes downtown off {bowl}',
  '{bat} flicks it with the wrists over mid-wicket', '{bat} sends {bowl} into orbit',
];
const SIX_CLOSE = [
  'That is out of the ground!', 'Somebody fetch the ball!', '{bowl} looks up at the sky.', 'Pure muscle and timing.',
  'The crowd is on its feet!', 'Somebody catch that!', 'Distance? Enormous.', 'Six more to the total.',
  'That is a statement shot.', 'The fielders are just spectators.', 'What a clean hit!', 'Paisa vasool!',
  'That will be on the highlights.', 'Big runs, big momentum.', '{bowl} needs a new plan.',
];

const WK_OPEN = [
  'OUT!', 'GONE!', 'WICKET!', 'Got him!', 'Breakthrough!', 'Huge moment!', 'Big wicket!', 'Wicket falls!',
  'What a moment!', 'That is out!', 'The stay is over!', 'Celebrations!', 'Massive blow!', 'Out goes the batter!',
  'Strike!',
];
const WK_CLOSE = [
  'What a moment for the fielding side!', 'The team erupts in celebration.', 'Big blow for the batting side.',
  'That changes the game.', 'Long walk back for {bat}.', 'Pressure building now.', 'Ab mazaa aayega!',
  'The fielding side is on fire.', 'A key moment in this match.', 'Partnership broken.', 'Brilliant cricket.',
  'What a time to strike!',
];
const WK_ACT: Record<string, string[]> = {
  Bowled: [
    '{bowl} crashes through the defence of {bat} and hits the stumps', '{bat} misses and the off stump is cartwheeling',
    '{bowl} bowls a peach that shatters the stumps', '{bat} plays all around it, middle stump knocked back',
    'the yorker from {bowl} sneaks under the bat of {bat}', 'inside edge onto the stumps, {bat} drags it on',
    '{bowl} beats the outside edge and clips off stump', 'the bails go flying as {bowl} cleans up {bat}',
  ],
  Caught: [
    '{bat} goes big and {fld} takes a fine catch off {bowl}', '{bat} edges {bowl} and {fld} makes no mistake',
    '{bat} skies it and {fld} settles under it', '{fld} dives forward and holds on to the drive from {bat}',
    '{bat} finds {fld} in the deep off {bowl}', '{fld} takes a stunner to send {bat} back',
    '{bat} mistimes the pull and {fld} pouches it', '{fld} runs back and completes a superb catch off {bowl}',
  ],
  CaughtBowled: [
    '{bowl} takes a sharp return catch to dismiss {bat}', '{bat} drives it straight back and {bowl} holds on',
    '{bowl} dives to the side and grabs it one-handed', '{bat} chips it back and {bowl} gobbles it up',
    'a simple return catch, {bowl} accepts the gift from {bat}', '{bowl} reacts in a flash and catches {bat}',
    '{bat} checks the shot and {bowl} takes it in the follow-through', 'caught and bowled! {bowl} does it all alone against {bat}',
  ],
  LBW: [
    '{bowl} traps {bat} plumb in front', 'the umpire raises the finger, {bat} is lbw to {bowl}',
    '{bat} misses the flick and is struck on the pad', 'the inswinger from {bowl} hits {bat} right in front',
    '{bat} shoulders arms and is pinned lbw', 'dead plumb, {bat} has to go',
    '{bowl} skids one through and {bat} is lbw', '{bat} is beaten by the pace of {bowl}, lbw',
  ],
  'Run Out': [
    '{fld} hits the stumps and {bat} is short of the crease', 'a direct hit from {fld} catches {bat} short',
    '{bat} sets off for a risky run and {fld} finishes it', 'mix-up in the middle and {bat} is run out by {fld}',
    '{fld} throws to the keeper and {bat} is short', 'brilliant fielding by {fld} runs out {bat}',
    '{bat} dives but the throw from {fld} is too quick', '{fld} picks up and fires in, {bat} is gone',
  ],
  Stumped: [
    '{bat} steps out to {bowl}, misses, and {fld} whips the bails off', 'lightning work by {fld}, {bat} is stumped',
    '{bat} is beaten by the turn and {fld} does the rest', '{fld} is quick as a flash, {bat} stumped off {bowl}',
    '{bat} drags the back foot and {fld} breaks the stumps', '{bowl} lures {bat} out and {fld} completes the stumping',
    '{bat} is way out of the crease, {fld} makes no mistake', '{fld} collects cleanly and {bat} is stumped',
  ],
  'Hit Wicket': [
    '{bat} goes back too far and knocks the stumps', 'the bat of {bat} clips the stumps while playing {bowl}',
    'an unusual dismissal, {bat} is out hit wicket', '{bat} loses balance and dislodges the bails',
    '{bat} treads on the stumps, hit wicket off {bowl}', 'the back leg brushes the stumps, {bat} has to go',
    '{bat} hits the wicket in the follow-through', '{bowl} gets lucky as {bat} hits the wicket',
  ],
};

const DOT = [
  'no run, solid defence', 'no run, beaten outside off', 'no run, straight to the fielder', 'no run, left alone',
  'no run, good length and well bowled', 'no run, played back to the bowler', 'dot ball, tight line',
];
const RUNS: Record<number, string[]> = {
  1: ['1 run, pushed to mid-on for a quick single', '1 run, tapped and run', '1 run, worked to square leg',
    '1 run, dabbed down to third man', '1 run, nudged into the gap'],
  2: ['2 runs, driven into the deep', '2 runs, good running between the wickets', '2 runs, placed wide of long-on',
    '2 runs, the fielder cuts it off in the deep'],
  3: ['3 runs, excellent running', '3 runs, chased down just inside the rope', '3 runs, they push hard for the third'],
};

// Lines available per category (opener × action × closer)
export const COMMENTARY_VARIETY = {
  four: FOUR_OPEN.length * FOUR_ACT.length * FOUR_CLOSE.length,
  six: SIX_OPEN.length * SIX_ACT.length * SIX_CLOSE.length,
  wicket: Object.values(WK_ACT).reduce((n, a) => n + WK_OPEN.length * a.length * WK_CLOSE.length, 0),
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export type BallEvent = {
  bat: string; bowl: string; runs: number; extra?: string;
  wicket?: { type: string; fielder?: string; outBatter: string };
};

export function commentaryFor(e: BallEvent): string {
  const v = { bat: e.bat, bowl: e.bowl };
  if (e.wicket) {
    const w = { bat: e.wicket.outBatter, bowl: e.bowl, fld: e.wicket.fielder };
    const key = e.wicket.type === 'Caught' && (!w.fld || w.fld === e.bowl) ? 'CaughtBowled' : e.wicket.type;
    const acts = WK_ACT[key] || WK_ACT.Bowled;
    return `${pick(WK_OPEN)} ${cap(fill(pick(acts), w))}. ${fill(pick(WK_CLOSE), w)}`;
  }
  if (!e.extra && e.runs === 6) return `${pick(SIX_OPEN)} ${cap(fill(pick(SIX_ACT), v))}. ${fill(pick(SIX_CLOSE), v)}`;
  if (!e.extra && e.runs === 4) return `${pick(FOUR_OPEN)} ${cap(fill(pick(FOUR_ACT), v))}. ${fill(pick(FOUR_CLOSE), v)}`;
  const lead = `${e.bowl} to ${e.bat}`;
  switch (e.extra) {
    case 'wd': return `${lead}, wide${e.runs > 1 ? `, ${e.runs} runs` : ''}. Strays down the leg side.`;
    case 'nb': return `${lead}, no ball! ${e.runs > 1 ? `${e.runs} runs. ` : ''}Free runs for the batting side.`;
    case 'lb': return `${lead}, ${e.runs} leg bye${e.runs === 1 ? '' : 's'}, off the pad.`;
    case 'b': return `${lead}, ${e.runs} bye${e.runs === 1 ? '' : 's'}, past the keeper.`;
    case 'db': return `${lead}, dead ball. Not counted.`;
  }
  if (e.runs === 0) return `${lead}, ${pick(DOT)}.`;
  return `${lead}, ${pick(RUNS[e.runs] || [`${e.runs} runs`])}.`;
}
