import { it } from 'vitest';
import { diffWorlds, makeSpec, playDevice, replayOnServer, type Checkpoint } from './soak-engine';

/* DIAG=spec,cap [EVERY=n] npx vitest run soak-diag: finds the first checkpoint where the server's copy parts, and shows how. */
it.skipIf(!process.env.DIAG)('diag', () => {
  const [id, cap] = process.env.DIAG!.split(',').map(Number) as [number, number];
  const spec = { ...makeSpec(id!), cap: cap! };
  const every = Number(process.env.EVERY ?? 1);
  const played = playDevice(spec, { every, explain: true });
  console.log('device', played.stats.actions, played.failures.map((f) => f.message));
  const fails = replayOnServer(spec, played, { reload: !process.env.NORELOAD });
  console.log('replay', JSON.stringify(fails));
  const first = fails[0];
  if (!first || first.kind === 'server') return;
  const e = played.log.slice(Math.max(0, first.at - 6), first.at + 1);
  console.log(JSON.stringify(e));
  let snap: string | undefined;
  playDevice(spec, { every, snapshot: (w, cp) => { if (cp.n === first.at) snap = JSON.stringify(w); } });
  replayOnServer(spec, played, {
    onParted: (w: unknown, cp: Checkpoint) => {
      const dev = snap ? JSON.parse(snap) : null;
      console.log('hero', JSON.stringify(dev?.heroes[0]).slice(0, 200), 'levels', Object.keys((w as { levels: object }).levels).join(','));
      console.log('parted at', cp.n, snap ? diffWorlds(JSON.parse(snap), JSON.parse(JSON.stringify(w))) : 'no snapshot');
    },
  });
}, 900000);
