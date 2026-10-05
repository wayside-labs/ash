// The bound for "hostile input at the body cap finishes fast". What these tests guard against is
// a regex or a loop that is quadratic or worse, not an absolute speed: at the cap (300 000
// characters) the linear code takes a few milliseconds, and the quadratic versions it replaced
// took tens of seconds (reading-time.ts records one at 95 s).
//
// So the bound sits far from both: wide enough that a busy machine or a loaded CI runner does
// not fail a linear function (200 ms did, once, with another process on the CPU), and still more
// than ten times under the fastest super-linear case. A scaling assertion (time at 2n against
// time at n) was the other option; at a few milliseconds per run it is noisier than this, not
// less.
export const HOSTILE_INPUT_BUDGET_MS = 2_000;
