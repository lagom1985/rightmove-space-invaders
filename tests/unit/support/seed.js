import fc from 'fast-check';

// Replays a failing property: FC_SEED=<the seed fast-check printed> npx playwright test --project=unit.
// Unset, fast-check picks a fresh seed each run, as it always has. The acceptance harness reads the same variable.
if (process.env.FC_SEED) fc.configureGlobal({ seed: Number(process.env.FC_SEED) });
